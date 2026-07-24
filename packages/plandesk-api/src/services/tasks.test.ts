import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createEdge,
  createGoal,
  createProjectInDefaultOrg as createProject,
  createTag,
  getDocument,
  getOrCreateDefaultGoal,
  getTask,
  InvalidTaskStatusError,
  listEdges,
  listTags,
  listTasks,
  migrate,
  updateGoalStatus,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { InvalidTagError } from './tags.js';
import { createTaskService, InvalidGoalReferenceError } from './tasks.js';

describe('taskService', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
  });
    let projectId = '';
  let orgId = '';

  function createService() {
    return createTaskService({ db, orgId });
  }

  beforeEach(async () => {
    await migrate(db);
    await db.$client.execute('DELETE FROM edges');
    await db.$client.execute('DELETE FROM documents');
    await db.$client.execute('DELETE FROM task_tags');
    await db.$client.execute('DELETE FROM tags');
    await db.$client.execute('DELETE FROM tasks');
    await db.$client.execute('DELETE FROM goals');
    await db.$client.execute('DELETE FROM projects');
    const project = await createProject(db, { name: 'Project' });
    projectId = project.id;
    orgId = project.orgId;
  });

  it('lists tasks for a project with optional status filter', async () => {
    const service = createService();
    await createTask(db, { projectId, label: 'Todo', status: 'todo' });
    await createTask(db, { projectId, label: 'Done', status: 'done' });

    expect(await service.listByProject(projectId)).toHaveLength(2);
    const filtered = await service.listByProject(projectId, { status: 'todo' });
    expect(filtered).toEqual([expect.objectContaining({ status: 'todo' })]);
    expect(await listTasks(db, projectId, { status: 'done' })).toHaveLength(1);
  });

  it('returns undefined when the project is missing', async () => {
    const service = createService();
    expect(await service.listByProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('rejects an invalid status filter', async () => {
    const service = createService();
    await expect(service.listByProject(projectId, { status: 'invalid' })).rejects.toThrow(
      InvalidTaskStatusError,
    );
  });

  it('updates a task and bumps updated_at in serialized output', async () => {
    const service = createService();
    const created = await createTask(db, { projectId, label: 'Before', status: 'todo' });
    const updated = await service.update(created.id, {
      status: 'in_progress',
      label: 'After',
      description: 'Updated',
      x: 10,
      y: 20,
    });

    expect(updated).toMatchObject({
      id: created.id,
      status: 'in_progress',
      label: 'After',
      description: 'Updated',
      x: 10,
      y: 20,
    });
    expect(updated).toBeDefined();
    if (!updated) {
      throw new Error('expected updated task');
    }
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );
  });

  it('creates a task', async () => {
    const service = createTaskService({ db, orgId });

    const created = await service.create(projectId, {
      label: 'New task',
      status: 'todo',
      x: 5,
      y: 6,
    });
    expect(created).toMatchObject({
      project_id: projectId,
      label: 'New task',
      status: 'todo',
      x: 5,
      y: 6,
    });
    expect(created).toBeDefined();
    if (!created) {
      throw new Error('expected created task');
    }
  });

  it('returns undefined when creating a task for a missing project', async () => {
    const service = createService();
    expect(
      await service.create('00000000-0000-4000-8000-000000009999', { label: 'Ghost' }),
    ).toBeUndefined();
  });

  it('places a task under an explicit goal_id (planner decomposition)', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'Ship the thing' });
    const created = await service.create(projectId, { label: 'Cycle 1', goalId: goal.id });
    expect(created?.goal_id).toBe(goal.id);
  });

  it('rejects a goal_id that does not belong to the project', async () => {
    const service = createService();
    const otherProject = await createProject(db, { name: 'Other' });
    const foreignGoal = await createGoal(db, { projectId: otherProject.id, objective: 'Elsewhere' });
    await expect(service.create(projectId, { label: 'Wrong goal', goalId: foreignGoal.id }),).rejects.toThrow(InvalidGoalReferenceError);
  });

  it('returns undefined when updating a missing task', async () => {
    const service = createService();
    expect(
      await service.update('00000000-0000-4000-8000-000000009999', { status: 'done' }),
    ).toBeUndefined();
  });

  it('updates a task successfully', async () => {
    const service = createTaskService({ db, orgId });
    const created = await createTask(db, { projectId, label: 'Emit', status: 'todo' });

    const updated = await service.update(created.id, { status: 'done' });
    expect(updated).toMatchObject({ id: created.id, status: 'done' });
  });

  it('reassigns a task to a different goal in the same project (#15)', async () => {
    const service = createService();
    const goalA = await createGoal(db, { projectId, objective: 'Goal A' });
    const goalB = await createGoal(db, { projectId, objective: 'Goal B' });
    const created = await service.create(projectId, { label: 'Movable', goalId: goalA.id });
    if (!created) {
      throw new Error('expected created task');
    }

    const updated = await service.update(created.id, { goalId: goalB.id });
    expect(updated?.goal_id).toBe(goalB.id);
    expect(await service.get(created.id)).toMatchObject({ goal_id: goalB.id });
  });

  it('rejects reassigning a task to a goal_id from a different project (#15)', async () => {
    const service = createService();
    const goalA = await createGoal(db, { projectId, objective: 'Goal A' });
    const otherProject = await createProject(db, { name: 'Other' });
    const foreignGoal = await createGoal(db, { projectId: otherProject.id, objective: 'Elsewhere' });
    const created = await service.create(projectId, { label: 'Movable', goalId: goalA.id });
    if (!created) {
      throw new Error('expected created task');
    }

    await expect(
      service.update(created.id, { goalId: foreignGoal.id }),
    ).rejects.toThrow(InvalidGoalReferenceError);
  });

  it('deletes a task, cascades edges, and nulls linked documents', async () => {
    const service = createService();
    const task = await createTask(db, { projectId, label: 'Delete me' });
    await createEdge(db, { projectId, fromTaskId: task.id, toTaskId: task.id });
    const doc = await createDocument(db, {
      projectId,
      title: 'Linked',
      linkedTaskId: task.id,
    });

    expect(await service.delete(task.id)).toBe(true);
    expect(await getTask(db, task.id)).toBeUndefined();
    expect(await listEdges(db, projectId)).toHaveLength(0);
    expect((await getDocument(db, doc.id))?.linkedTaskId).toBeNull();
  });

  it('returns false when deleting a missing task', async () => {
    const service = createService();
    expect(await service.delete('00000000-0000-4000-8000-000000009999')).toBe(false);
  });

  it('paginates task list', async () => {
    const service = createService();
    await createTask(db, { projectId, label: 'A' });
    await createTask(db, { projectId, label: 'B' });
    await createTask(db, { projectId, label: 'C' });
    const page = await service.listByProject(projectId, {}, { limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
  });

  it('returns undefined for nextActionable when project is missing', async () => {
    const service = createService();
    expect(await service.nextActionable('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('returns no_tasks when project has no tasks on the active goal', async () => {
    const service = createService();
    getOrCreateDefaultGoal(db, projectId);
    expect(await service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_tasks',
      blocked: [],
    });
  });

  it('returns no_todo_tasks when all tasks are done', async () => {
    const service = createService();
    await createTask(db, { projectId, label: 'Done', status: 'done' });
    expect(await service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_todo_tasks',
      blocked: [],
    });
  });

  it('returns the first actionable todo by creation order', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A', status: 'done' });
    const b = await createTask(db, { projectId, label: 'B', status: 'todo' });
    await createTask(db, { projectId, label: 'C', status: 'todo' });
    await createEdge(db, { projectId, fromTaskId: a.id, toTaskId: b.id, label: 'blocks' });

    const result = await service.nextActionable(projectId);
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(b.id);
    expect(result?.blocked).toEqual([]);
  });

  it('returns all_blocked when every todo has unfinished prerequisites', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A', status: 'todo' });
    const b = await createTask(db, { projectId, label: 'B', status: 'todo' });
    await createEdge(db, { projectId, fromTaskId: a.id, toTaskId: b.id, label: 'blocks' });
    await createEdge(db, { projectId, fromTaskId: b.id, toTaskId: a.id, label: 'blocks' });

    const result = await service.nextActionable(projectId);
    expect(result?.next_task).toBeNull();
    expect(result?.reason).toBe('all_blocked');
    expect(result?.blocked).toHaveLength(2);
    expect(result?.blocked[0]?.task.id).toBe(a.id);
    expect(result?.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([b.id]);
    expect(result?.blocked[1]?.task.id).toBe(b.id);
    expect(result?.blocked[1]?.waiting_on.map((task) => task.id)).toEqual([a.id]);
  });

  it('treats depends_on edges with reversed prerequisite direction', async () => {
    const service = createService();
    const a = await createTask(db, { projectId, label: 'A', status: 'todo' });
    const b = await createTask(db, { projectId, label: 'B', status: 'todo' });
    await createEdge(db, { projectId, fromTaskId: b.id, toTaskId: a.id, label: 'depends_on' });

    const result = await service.nextActionable(projectId);
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(a.id);
    expect(result?.blocked).toHaveLength(1);
    expect(result?.blocked[0]?.task.id).toBe(b.id);
    expect(result?.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([a.id]);
  });

  it('create with tags sets the tag set and auto-creates unknown names', async () => {
    const service = createService();
    const created = await service.create(projectId, {
      label: 'Tagged',
      tags: ['backend', ' urgent ', 'backend'],
    });

    expect(created?.tags?.map((tag) => tag.name)).toEqual(['backend', 'urgent']);
    expect((await listTags(db, projectId)).map((tag) => tag.name)).toEqual(['backend', 'urgent']);
  });

  it('create reuses an existing tag by name instead of duplicating it', async () => {
    const service = createService();
    const existing = await createTag(db, { projectId, name: 'backend', color: '#123456' });

    const created = await service.create(projectId, { label: 'Tagged', tags: ['backend'] });

    expect(created?.tags?.[0]?.id).toBe(existing.id);
    expect(created?.tags?.[0]?.color).toBe('#123456');
    expect(await listTags(db, projectId)).toHaveLength(1);
  });

  it('update with tags replaces the full set; omitting tags leaves them unchanged', async () => {
    const service = createService();
    const created = await service.create(projectId, { label: 'Tagged', tags: ['a', 'b'] });

    const untouched = await service.update(created?.id ?? '', { label: 'Renamed' });
    expect(untouched?.tags?.map((tag) => tag.name)).toEqual(['a', 'b']);

    const replaced = await service.update(created?.id ?? '', { tags: ['c'] });
    expect(replaced?.tags?.map((tag) => tag.name)).toEqual(['c']);

    const cleared = await service.update(created?.id ?? '', { tags: [] });
    expect(cleared?.tags).toEqual([]);
    // Replaced-away tags remain as project tags for reuse.
    expect((await listTags(db, projectId)).map((tag) => tag.name)).toEqual(['a', 'b', 'c']);
  });

  it('rejects blank tag names on create and update', async () => {
    const service = createService();
    await expect(service.create(projectId, { label: 'Bad', tags: ['  '] })).rejects.toThrow(
      InvalidTagError,
    );
    const created = await service.create(projectId, { label: 'Ok' });
    await expect(service.update(created?.id ?? '', { tags: [''] })).rejects.toThrow(InvalidTagError);
  });

  it('listByProject filters by tags with OR semantics and combines with status', async () => {
    const service = createService();
    const hasA = await service.create(projectId, { label: 'Has a', tags: ['a'] });
    const hasB = await service.create(projectId, { label: 'Has b', status: 'done', tags: ['b'] });
    const hasBoth = await service.create(projectId, { label: 'Has both', tags: ['a', 'b'] });
    await service.create(projectId, { label: 'Untagged' });

    const orFiltered = await service.listByProject(projectId, { tags: ['a', 'b'] });
    expect(orFiltered?.map((task) => task.id).sort()).toEqual(
      [hasA?.id, hasB?.id, hasBoth?.id].sort(),
    );

    const single = await service.listByProject(projectId, { tags: ['a'] });
    expect(single?.map((task) => task.id).sort()).toEqual([hasA?.id, hasBoth?.id].sort());

    const combined = await service.listByProject(projectId, { status: 'done', tags: ['a', 'b'] });
    expect(combined?.map((task) => task.id)).toEqual([hasB?.id]);

    expect(await service.listByProject(projectId, { tags: ['missing'] })).toEqual([]);
  });

  it('list output always carries the tags array', async () => {
    const service = createService();
    await service.create(projectId, { label: 'Untagged' });
    const listed = await service.listByProject(projectId);
    expect(listed?.[0]?.tags).toEqual([]);
  });

  it('delete cascades the task-tag associations but keeps the tags', async () => {
    const service = createService();
    const created = await service.create(projectId, { label: 'Tagged', tags: ['keep'] });

    expect(await service.delete(created?.id ?? '')).toBe(true);
    expect((await listTags(db, projectId)).map((tag) => tag.name)).toEqual(['keep']);
    expect((await db.$client.execute('SELECT COUNT(*) AS count FROM task_tags')).rows[0]).toEqual({
      count: 0,
    });
  });

  it('nextActionable with a tags filter only considers matching todo tasks (OR semantics)', async () => {
    const service = createService();
    const done = await createTask(db, { projectId, label: 'Done prereq', status: 'done' });
    const frontend = await service.create(projectId, { label: 'Frontend', tags: ['frontend'] });
    const backend = await service.create(projectId, { label: 'Backend', tags: ['backend'] });
    await createEdge(db, {
      projectId,
      fromTaskId: done.id,
      toTaskId: frontend?.id ?? '',
      label: 'blocks',
    });

    const unfiltered = await service.nextActionable(projectId);
    expect(unfiltered?.next_task?.id).toBe(frontend?.id);

    const backendOnly = await service.nextActionable(projectId, { tags: ['backend'] });
    expect(backendOnly?.next_task?.id).toBe(backend?.id);
    expect(backendOnly?.next_task?.tags?.map((tag) => tag.name)).toEqual(['backend']);

    const either = await service.nextActionable(projectId, { tags: ['backend', 'frontend'] });
    expect(either?.next_task?.id).toBe(frontend?.id);

    const none = await service.nextActionable(projectId, { tags: ['missing'] });
    expect(none).toEqual({ next_task: null, reason: 'no_todo_tasks', blocked: [] });
  });

  it('nextActionable preserves single-active-goal backward compat via default goal', async () => {
    const service = createService();
    const defaultGoal = await getOrCreateDefaultGoal(db, projectId);
    const task = await createTask(db, { projectId, label: 'On default goal', status: 'todo' });

    const result = await service.nextActionable(projectId);
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(task.id);
    expect(result?.next_task?.goal_id).toBe(defaultGoal.id);
  });

  it('nextActionable returns no_active_goal when no active goal exists', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'Paused', status: 'paused' });
    await createTask(db, { projectId, goalId: goal.id, label: 'Orphan todo', status: 'todo' });

    expect(await service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_active_goal',
      blocked: [],
    });
  });

  it('nextActionable returns no_tasks with multiple active goals when the project has no tasks', async () => {
    const service = createService();
    await createGoal(db, { projectId, objective: 'A', status: 'active' });
    await createGoal(db, { projectId, objective: 'B', status: 'active' });

    expect(await service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_tasks',
      blocked: [],
    });
  });

  it('nextActionable considers tasks across all active goals when goal_id is omitted (#18)', async () => {
    const service = createService();
    await createGoal(db, { projectId, objective: 'A', status: 'active' });
    const goalB = await createGoal(db, { projectId, objective: 'B', status: 'active' });
    const taskB = await createTask(db, { projectId, goalId: goalB.id, label: 'B todo', status: 'todo' });

    // No dead-end (#18): with >1 active goal and no goal_id, the union of
    // active goals' tasks is considered instead of erroring.
    const result = await service.nextActionable(projectId);
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(taskB.id);
    expect(result?.next_task?.goal_id).toBe(goalB.id);
  });

  it('nextActionable returns no_todo_tasks (not a dead end) when multiple active goals have no ready task', async () => {
    const service = createService();
    const goalA = await createGoal(db, { projectId, objective: 'A', status: 'active' });
    const goalB = await createGoal(db, { projectId, objective: 'B', status: 'active' });
    await createTask(db, { projectId, goalId: goalA.id, label: 'A done', status: 'done' });
    await createTask(db, { projectId, goalId: goalB.id, label: 'B in progress', status: 'in_progress' });

    expect(await service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_todo_tasks',
      blocked: [],
    });
  });

  it('nextActionable still scopes to one goal via goal_id when multiple goals are active', async () => {
    const service = createService();
    const goalA = await createGoal(db, { projectId, objective: 'A', status: 'active' });
    const goalB = await createGoal(db, { projectId, objective: 'B', status: 'active' });
    const taskA = await createTask(db, { projectId, goalId: goalA.id, label: 'A todo', status: 'todo' });
    await createTask(db, { projectId, goalId: goalB.id, label: 'B todo', status: 'todo' });

    const scoped = await service.nextActionable(projectId, { goalId: goalA.id });
    expect(scoped?.reason).toBe('ok');
    expect(scoped?.next_task?.id).toBe(taskA.id);
  });

  it('nextActionable scopes candidates to a specific goal', async () => {
    const service = createService();
    const goalA = await createGoal(db, { projectId, objective: 'Goal A', status: 'active' });
    const goalB = await createGoal(db, { projectId, objective: 'Goal B', status: 'paused' });
    await updateGoalStatus(db, (await getOrCreateDefaultGoal(db, projectId)).id, 'paused');
    const taskA = await createTask(db, { projectId, goalId: goalA.id, label: 'A todo', status: 'todo' });
    await createTask(db, { projectId, goalId: goalB.id, label: 'B todo', status: 'todo' });

    const scoped = await service.nextActionable(projectId, { goalId: goalA.id });
    expect(scoped?.reason).toBe('ok');
    expect(scoped?.next_task?.id).toBe(taskA.id);

    const scopedB = await service.nextActionable(projectId, { goalId: goalB.id });
    expect(scopedB?.reason).toBe('ok');
    expect(scopedB?.next_task?.goal_id).toBe(goalB.id);

    const emptyGoal = await createGoal(db, { projectId, objective: 'Empty', status: 'active' });
    expect(await service.nextActionable(projectId, { goalId: emptyGoal.id })).toEqual({
      next_task: null,
      reason: 'no_todo_tasks',
      blocked: [],
    });
    expect(
      await service.nextActionable(projectId, {
        goalId: '00000000-0000-4000-8000-000000009999',
      }),
    ).toBeUndefined();
  });

  it('nextActionable composes goal scoping with tags filter', async () => {
    const service = createService();
    const goal = await createGoal(db, { projectId, objective: 'Tagged goal', status: 'active' });
    await updateGoalStatus(db, (await getOrCreateDefaultGoal(db, projectId)).id, 'paused');
    const tagged = await service.create(projectId, {
      label: 'Tagged in goal',
      goalId: goal.id,
      tags: ['x'],
    });
    await createTask(db, { projectId, goalId: goal.id, label: 'Untagged in goal', status: 'todo' });
    await createTask(db, {
      projectId,
      goalId: (await getOrCreateDefaultGoal(db, projectId)).id,
      label: 'Other goal tagged',
      status: 'todo',
    });

    const result = await service.nextActionable(projectId, { goalId: goal.id, tags: ['x'] });
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(tagged?.id);
  });

  it('nextActionable tags filter keeps prerequisite evaluation across all tasks', async () => {
    const service = createService();
    const prereq = await service.create(projectId, { label: 'Untagged prereq', status: 'todo' });
    const tagged = await service.create(projectId, { label: 'Tagged dependent', tags: ['x'] });
    await createEdge(db, {
      projectId,
      fromTaskId: prereq?.id ?? '',
      toTaskId: tagged?.id ?? '',
      label: 'blocks',
    });

    const result = await service.nextActionable(projectId, { tags: ['x'] });
    expect(result?.next_task).toBeNull();
    expect(result?.reason).toBe('all_blocked');
    expect(result?.blocked[0]?.task.id).toBe(tagged?.id);
    expect(result?.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([prereq?.id]);
  });

  it('claim marks a todo task in_progress with the agent_ref assignee', async () => {
    const service = createService();
    const created = await createTask(db, { projectId, label: 'Claim me', status: 'todo' });

    const result = await service.claim(created.id, 'agent-42');
    expect(result).toEqual({
      claimed: true,
      task: expect.objectContaining({
        id: created.id,
        status: 'in_progress',
        assignee: 'agent-42',
      }),
    });
  });

  it('claim on an already in_progress task returns not-claimed', async () => {
    const service = createService();
    const created = await createTask(db, {
      projectId,
      label: 'Taken',
      status: 'in_progress',
      assignee: 'agent-a',
    });

    const result = await service.claim(created.id, 'agent-b');
    expect(result).toEqual({ claimed: false, reason: 'taken_or_not_actionable' });
  });

  it('claim with a foreign org scope returns not-claimed (tenancy)', async () => {
    const foreign = createTaskService({ db, orgId: '00000000-0000-4000-8000-00000000ffff' });
    const created = await createTask(db, { projectId, label: 'A-only', status: 'todo' });

    const result = await foreign.claim(created.id, 'agent-b');
    expect(result).toBeUndefined();

    const stored = await getTask(db, created.id);
    expect(stored?.status).toBe('todo');
  });
});
