import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';

import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import {
  claimTask,
  getTask,
  InvalidTaskKindError,
  InvalidTaskLaneError,
  InvalidTaskPriorityError,
  InvalidTaskSeverityError,
  InvalidTaskStatusError,
  listTasks,
  updateTask,
} from './tasks.js';
import { createTag, setTaskTags } from './tags.js';
import { taskPriorityOrder, type TaskPriority } from '../schema.js';

describe('tasks repository', () => {
  let db: Db;
  let projectId = '';

  beforeEach(async () => {
    db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Test Project' });
    projectId = project.id;
  });

  it('creates and retrieves a task with REQ-4 fields', async () => {
    const dueDate = new Date('2026-12-31T00:00:00.000Z');
    const created = await createTask(db, {
      projectId,
      label: 'Implement auth',
      status: 'in_progress',
      description: 'OAuth flow',
      assignee: 'dev@example.com',
      dueDate,
      x: 120,
      y: 48,
    });
    const fetched = await getTask(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.status).toBe('in_progress');
    expect(fetched?.assignee).toBe('dev@example.com');
    expect(fetched?.dueDate?.toISOString()).toBe(dueDate.toISOString());
  });

  it('returns undefined for a missing task', async () => {
    expect(await getTask(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists tasks for a project', async () => {
    await createTask(db, { projectId, label: 'One' });
    await createTask(db, { projectId, label: 'Two' });
    const tasks = await listTasks(db, projectId);
    expect(tasks).toHaveLength(2);
  });

  it('lists tasks filtered by status', async () => {
    await createTask(db, { projectId, label: 'Todo', status: 'todo' });
    await createTask(db, { projectId, label: 'Done', status: 'done' });
    expect(await listTasks(db, projectId, { status: 'todo' })).toHaveLength(1);
    expect((await listTasks(db, projectId, { status: 'done' }))[0]?.status).toBe('done');
  });

  it('defaults kind to build and filters by kind', async () => {
    await createTask(db, { projectId, label: 'Build task' });
    await createTask(db, { projectId, label: 'Decision task', kind: 'decision' });
    const all = await listTasks(db, projectId);
    const first = all[0];
    expect(first).toBeDefined();
    if (!first) {
      throw new Error('expected a task');
    }
    expect((await getTask(db, first.id))?.kind).toBe('build');
    expect(await listTasks(db, projectId, { kind: 'decision' })).toHaveLength(1);
    expect(await listTasks(db, projectId, { kind: 'build' })).toHaveLength(1);
  });

  it('rejects an invalid kind on create', async () => {
    await expect(
      createTask(db, {
        projectId,
        label: 'Bad kind',
        kind: 'invalid' as 'build',
      }),
    ).rejects.toThrow(InvalidTaskKindError);
  });

  it('rejects an invalid kind on update', async () => {
    const task = await createTask(db, { projectId, label: 'Task' });
    await expect(updateTask(db, task.id, { kind: 'invalid' as 'build' })).rejects.toThrow(
      InvalidTaskKindError,
    );
  });

  it('creates without priority as null; set, clear with null, omit leaves unchanged', async () => {
    const created = await createTask(db, { projectId, label: 'No priority' });
    expect(created.priority).toBeNull();
    expect((await getTask(db, created.id))?.priority).toBeNull();

    const set = await updateTask(db, created.id, { priority: 'high' });
    expect(set?.priority).toBe('high');

    const cleared = await updateTask(db, created.id, { priority: null });
    expect(cleared?.priority).toBeNull();

    await updateTask(db, created.id, { priority: 'medium' });
    const omitted = await updateTask(db, created.id, { label: 'Renamed' });
    expect(omitted?.priority).toBe('medium');
    expect(omitted?.label).toBe('Renamed');
  });

  it('rejects an invalid priority on create and update', async () => {
    await expect(
      createTask(db, {
        projectId,
        label: 'Bad priority',
        priority: 'critical' as 'high',
      }),
    ).rejects.toThrow(InvalidTaskPriorityError);

    const task = await createTask(db, { projectId, label: 'Task', priority: 'low' });
    await expect(updateTask(db, task.id, { priority: 'critical' as 'low' })).rejects.toThrow(
      InvalidTaskPriorityError,
    );
  });

  it('creates, updates, reads, and filters typed lane and severity fields', async () => {
    const created = await createTask(db, {
      projectId,
      label: 'Typed task',
      lane: 'approve',
      severity: 'high',
    });
    expect(created.lane).toBe('approve');
    expect(created.severity).toBe('high');
    expect((await getTask(db, created.id))?.lane).toBe('approve');
    expect((await getTask(db, created.id))?.severity).toBe('high');

    const updated = await updateTask(db, created.id, { lane: 'full', severity: 'medium' });
    expect(updated?.lane).toBe('full');
    expect(updated?.severity).toBe('medium');
    expect(await listTasks(db, projectId, { lane: 'full', severity: 'medium' })).toEqual([
      expect.objectContaining({ id: created.id, lane: 'full', severity: 'medium' }),
    ]);
  });

  it('rejects invalid lane and severity values on create and update', async () => {
    await expect(
      createTask(db, { projectId, label: 'Bad lane', lane: 'manual' as 'auto' }),
    ).rejects.toThrow(InvalidTaskLaneError);
    await expect(
      createTask(db, { projectId, label: 'Bad severity', severity: 'critical' as 'high' }),
    ).rejects.toThrow(InvalidTaskSeverityError);
    const task = await createTask(db, { projectId, label: 'Task' });
    await expect(updateTask(db, task.id, { lane: 'manual' as 'auto' })).rejects.toThrow(
      InvalidTaskLaneError,
    );
    await expect(updateTask(db, task.id, { severity: 'critical' as 'high' })).rejects.toThrow(
      InvalidTaskSeverityError,
    );
  });

  it('filters by priority and composes with status, kind, and tags', async () => {
    const highTodo = await createTask(db, {
      projectId,
      label: 'High todo',
      status: 'todo',
      kind: 'build',
      priority: 'high',
    });
    await createTask(db, {
      projectId,
      label: 'High done',
      status: 'done',
      kind: 'build',
      priority: 'high',
    });
    await createTask(db, {
      projectId,
      label: 'Low decision',
      status: 'todo',
      kind: 'decision',
      priority: 'low',
    });
    const tag = await createTag(db, { projectId, name: 'area:api' });
    await setTaskTags(db, highTodo.id, [tag.id]);

    expect(await listTasks(db, projectId, { priority: 'high' })).toHaveLength(2);
    expect(
      await listTasks(db, projectId, { priority: 'high', status: 'todo', kind: 'build' }),
    ).toHaveLength(1);
    expect(
      await listTasks(db, projectId, {
        priority: 'high',
        status: 'todo',
        kind: 'build',
        tagNames: ['area:api'],
      }),
    ).toEqual([expect.objectContaining({ id: highTodo.id, priority: 'high' })]);
    expect(
      await listTasks(db, projectId, { priority: 'high', tagNames: ['missing'] }),
    ).toHaveLength(0);
  });

  it('taskPriorityOrder sorts urgent → high → medium → low, with null last', () => {
    const mixed: Array<TaskPriority | null> = ['low', null, 'urgent', 'medium', 'high', null];
    const sorted = [...mixed].sort((a, b) => {
      const rankA = a === null ? Number.POSITIVE_INFINITY : taskPriorityOrder[a];
      const rankB = b === null ? Number.POSITIVE_INFINITY : taskPriorityOrder[b];
      return rankA - rankB;
    });
    expect(sorted).toEqual(['urgent', 'high', 'medium', 'low', null, null]);
  });

  it('rejects an invalid status on create', async () => {
    await expect(
      createTask(db, {
        projectId,
        label: 'Bad status',
        status: 'invalid' as 'todo',
      }),
    ).rejects.toThrow(InvalidTaskStatusError);
  });

  it('rejects an invalid status on update', async () => {
    const task = await createTask(db, { projectId, label: 'Task' });
    await expect(updateTask(db, task.id, { status: 'invalid' as 'todo' })).rejects.toThrow(
      InvalidTaskStatusError,
    );
  });

  it('updates a task and bumps updated_at', async () => {
    const created = await createTask(db, { projectId, label: 'Before', status: 'todo' });
    const updated = await updateTask(db, created.id, { status: 'done', label: 'After' });
    expect(updated?.status).toBe('done');
    expect(updated?.label).toBe('After');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('updateTask with a stale expectedUpdatedAt fails rather than clobbering', async () => {
    const created = await createTask(db, { projectId, label: 'Race', status: 'todo' });
    // Advance past create timestamp so the CAS value differs at ms resolution.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const first = await updateTask(
      db,
      created.id,
      { label: 'Winner' },
      { expectedUpdatedAt: created.updatedAt },
    );
    expect(first?.label).toBe('Winner');
    expect(first?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    const stale = await updateTask(
      db,
      created.id,
      { label: 'Stale clobber' },
      { expectedUpdatedAt: created.updatedAt },
    );
    expect(stale).toBeUndefined();

    const current = await getTask(db, created.id);
    expect(current?.label).toBe('Winner');
  });

  it('test:claim_race — concurrent claimTask yields exactly one winner', async () => {
    const project = await createProject(db, { name: 'Claim Race' });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Only one may claim',
      status: 'todo',
    });

    const [a, b] = await Promise.all([
      claimTask(db, task.id, project.orgId, 'agent-a'),
      claimTask(db, task.id, project.orgId, 'agent-b'),
    ]);

    const winners = [a, b].filter((row) => row !== undefined);
    const losers = [a, b].filter((row) => row === undefined);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.status).toBe('in_progress');
    expect(['agent-a', 'agent-b']).toContain(winners[0]?.assignee);

    const stored = await getTask(db, task.id);
    expect(stored?.status).toBe('in_progress');
    expect(stored?.assignee).toBe(winners[0]?.assignee);
  });

  it('claimTask on an already in_progress task returns undefined', async () => {
    const project = await createProject(db, { name: 'Taken' });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Busy',
      status: 'in_progress',
      assignee: 'agent-a',
    });

    const claimed = await claimTask(db, task.id, project.orgId, 'agent-b');
    expect(claimed).toBeUndefined();

    const stored = await getTask(db, task.id);
    expect(stored?.assignee).toBe('agent-a');
    expect(stored?.status).toBe('in_progress');
  });

  it('claimTask with the wrong org returns undefined (tenancy)', async () => {
    const projectA = await createProject(db, { name: 'Org A project' });
    const orgBId = 'org-b-id';
    const task = await createTask(db, {
      projectId: projectA.id,
      label: 'A-only',
      status: 'todo',
    });

    const claimed = await claimTask(db, task.id, orgBId, 'agent-b');
    expect(claimed).toBeUndefined();

    const stored = await getTask(db, task.id);
    expect(stored?.status).toBe('todo');
    expect(stored?.assignee).toBeNull();
  });
});
