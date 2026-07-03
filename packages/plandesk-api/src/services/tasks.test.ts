import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createEdge,
  createProject,
  createTag,
  createTask,
  getDocument,
  getTask,
  InvalidTaskStatusError,
  listEdges,
  listTags,
  listTasks,
  migrate,
} from '@plandesk/db';
import { createEventBus, type TaskUpdatedEvent } from '../events.js';
import { InvalidTagError } from './tags.js';
import { createTaskService } from './tasks.js';

describe('taskService', () => {
  const db = createDb(':memory:');
  const eventBus = createEventBus();
  let projectId = '';

  function createService() {
    return createTaskService({ db, eventBus });
  }

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM edges');
    db.$client.exec('DELETE FROM documents');
    db.$client.exec('DELETE FROM task_tags');
    db.$client.exec('DELETE FROM tags');
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Project' }).id;
  });

  it('lists tasks for a project with optional status filter', () => {
    const service = createService();
    createTask(db, { projectId, label: 'Todo', status: 'todo' });
    createTask(db, { projectId, label: 'Done', status: 'done' });

    expect(service.listByProject(projectId)).toHaveLength(2);
    const filtered = service.listByProject(projectId, { status: 'todo' });
    expect(filtered).toEqual([expect.objectContaining({ status: 'todo' })]);
    expect(listTasks(db, projectId, { status: 'done' })).toHaveLength(1);
  });

  it('returns undefined when the project is missing', () => {
    const service = createService();
    expect(service.listByProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('rejects an invalid status filter', () => {
    const service = createService();
    expect(() => service.listByProject(projectId, { status: 'invalid' })).toThrow(
      InvalidTaskStatusError,
    );
  });

  it('updates a task and bumps updated_at in serialized output', () => {
    const service = createService();
    const created = createTask(db, { projectId, label: 'Before', status: 'todo' });
    const updated = service.update(created.id, {
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

  it('creates a task and emits task_updated', () => {
    const bus = createEventBus();
    const service = createTaskService({ db, eventBus: bus });
    const received: TaskUpdatedEvent[] = [];
    bus.subscribe((event) => {
      if (event.type === 'task_updated') {
        received.push(event);
      }
    });

    const created = service.create(projectId, {
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
    expect(received).toEqual([{ type: 'task_updated', taskId: created.id, projectId }]);
  });

  it('returns undefined when creating a task for a missing project', () => {
    const service = createService();
    expect(
      service.create('00000000-0000-4000-8000-000000009999', { label: 'Ghost' }),
    ).toBeUndefined();
  });

  it('returns undefined when updating a missing task', () => {
    const service = createService();
    expect(
      service.update('00000000-0000-4000-8000-000000009999', { status: 'done' }),
    ).toBeUndefined();
  });

  it('emits task_updated after a successful update', () => {
    const bus = createEventBus();
    const service = createTaskService({ db, eventBus: bus });
    const created = createTask(db, { projectId, label: 'Emit', status: 'todo' });
    const received: TaskUpdatedEvent[] = [];
    bus.subscribe((event) => {
      if (event.type === 'task_updated') {
        received.push(event);
      }
    });

    service.update(created.id, { status: 'done' });
    expect(received).toEqual([{ type: 'task_updated', taskId: created.id, projectId }]);
  });

  it('deletes a task, cascades edges, and nulls linked documents', () => {
    const service = createService();
    const task = createTask(db, { projectId, label: 'Delete me' });
    createEdge(db, { projectId, fromTaskId: task.id, toTaskId: task.id });
    const doc = createDocument(db, {
      projectId,
      title: 'Linked',
      linkedTaskId: task.id,
    });

    expect(service.delete(task.id)).toBe(true);
    expect(getTask(db, task.id)).toBeUndefined();
    expect(listEdges(db, projectId)).toHaveLength(0);
    expect(getDocument(db, doc.id)?.linkedTaskId).toBeNull();
  });

  it('returns false when deleting a missing task', () => {
    const service = createService();
    expect(service.delete('00000000-0000-4000-8000-000000009999')).toBe(false);
  });

  it('paginates task list', () => {
    const service = createService();
    createTask(db, { projectId, label: 'A' });
    createTask(db, { projectId, label: 'B' });
    createTask(db, { projectId, label: 'C' });
    const page = service.listByProject(projectId, {}, { limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
  });

  it('returns undefined for nextActionable when project is missing', () => {
    const service = createService();
    expect(service.nextActionable('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('returns no_tasks when project has no tasks', () => {
    const service = createService();
    expect(service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_tasks',
      blocked: [],
    });
  });

  it('returns no_todo_tasks when all tasks are done', () => {
    const service = createService();
    createTask(db, { projectId, label: 'Done', status: 'done' });
    expect(service.nextActionable(projectId)).toEqual({
      next_task: null,
      reason: 'no_todo_tasks',
      blocked: [],
    });
  });

  it('returns the first actionable todo by creation order', () => {
    const service = createService();
    const a = createTask(db, { projectId, label: 'A', status: 'done' });
    const b = createTask(db, { projectId, label: 'B', status: 'todo' });
    createTask(db, { projectId, label: 'C', status: 'todo' });
    createEdge(db, { projectId, fromTaskId: a.id, toTaskId: b.id, label: 'blocks' });

    const result = service.nextActionable(projectId);
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(b.id);
    expect(result?.blocked).toEqual([]);
  });

  it('returns all_blocked when every todo has unfinished prerequisites', () => {
    const service = createService();
    const a = createTask(db, { projectId, label: 'A', status: 'todo' });
    const b = createTask(db, { projectId, label: 'B', status: 'todo' });
    createEdge(db, { projectId, fromTaskId: a.id, toTaskId: b.id, label: 'blocks' });
    createEdge(db, { projectId, fromTaskId: b.id, toTaskId: a.id, label: 'blocks' });

    const result = service.nextActionable(projectId);
    expect(result?.next_task).toBeNull();
    expect(result?.reason).toBe('all_blocked');
    expect(result?.blocked).toHaveLength(2);
    expect(result?.blocked[0]?.task.id).toBe(a.id);
    expect(result?.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([b.id]);
    expect(result?.blocked[1]?.task.id).toBe(b.id);
    expect(result?.blocked[1]?.waiting_on.map((task) => task.id)).toEqual([a.id]);
  });

  it('treats depends_on edges with reversed prerequisite direction', () => {
    const service = createService();
    const a = createTask(db, { projectId, label: 'A', status: 'todo' });
    const b = createTask(db, { projectId, label: 'B', status: 'todo' });
    createEdge(db, { projectId, fromTaskId: b.id, toTaskId: a.id, label: 'depends_on' });

    const result = service.nextActionable(projectId);
    expect(result?.reason).toBe('ok');
    expect(result?.next_task?.id).toBe(a.id);
    expect(result?.blocked).toHaveLength(1);
    expect(result?.blocked[0]?.task.id).toBe(b.id);
    expect(result?.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([a.id]);
  });

  it('create with tags sets the tag set and auto-creates unknown names', () => {
    const service = createService();
    const created = service.create(projectId, {
      label: 'Tagged',
      tags: ['backend', ' urgent ', 'backend'],
    });

    expect(created?.tags?.map((tag) => tag.name)).toEqual(['backend', 'urgent']);
    expect(listTags(db, projectId).map((tag) => tag.name)).toEqual(['backend', 'urgent']);
  });

  it('create reuses an existing tag by name instead of duplicating it', () => {
    const service = createService();
    const existing = createTag(db, { projectId, name: 'backend', color: '#123456' });

    const created = service.create(projectId, { label: 'Tagged', tags: ['backend'] });

    expect(created?.tags?.[0]?.id).toBe(existing.id);
    expect(created?.tags?.[0]?.color).toBe('#123456');
    expect(listTags(db, projectId)).toHaveLength(1);
  });

  it('update with tags replaces the full set; omitting tags leaves them unchanged', () => {
    const service = createService();
    const created = service.create(projectId, { label: 'Tagged', tags: ['a', 'b'] });

    const untouched = service.update(created?.id ?? '', { label: 'Renamed' });
    expect(untouched?.tags?.map((tag) => tag.name)).toEqual(['a', 'b']);

    const replaced = service.update(created?.id ?? '', { tags: ['c'] });
    expect(replaced?.tags?.map((tag) => tag.name)).toEqual(['c']);

    const cleared = service.update(created?.id ?? '', { tags: [] });
    expect(cleared?.tags).toEqual([]);
    // Replaced-away tags remain as project tags for reuse.
    expect(listTags(db, projectId).map((tag) => tag.name)).toEqual(['a', 'b', 'c']);
  });

  it('rejects blank tag names on create and update', () => {
    const service = createService();
    expect(() => service.create(projectId, { label: 'Bad', tags: ['  '] })).toThrow(
      InvalidTagError,
    );
    const created = service.create(projectId, { label: 'Ok' });
    expect(() => service.update(created?.id ?? '', { tags: [''] })).toThrow(InvalidTagError);
  });

  it('listByProject filters by tags with OR semantics and combines with status', () => {
    const service = createService();
    const hasA = service.create(projectId, { label: 'Has a', tags: ['a'] });
    const hasB = service.create(projectId, { label: 'Has b', status: 'done', tags: ['b'] });
    const hasBoth = service.create(projectId, { label: 'Has both', tags: ['a', 'b'] });
    service.create(projectId, { label: 'Untagged' });

    const orFiltered = service.listByProject(projectId, { tags: ['a', 'b'] });
    expect(orFiltered?.map((task) => task.id).sort()).toEqual(
      [hasA?.id, hasB?.id, hasBoth?.id].sort(),
    );

    const single = service.listByProject(projectId, { tags: ['a'] });
    expect(single?.map((task) => task.id).sort()).toEqual([hasA?.id, hasBoth?.id].sort());

    const combined = service.listByProject(projectId, { status: 'done', tags: ['a', 'b'] });
    expect(combined?.map((task) => task.id)).toEqual([hasB?.id]);

    expect(service.listByProject(projectId, { tags: ['missing'] })).toEqual([]);
  });

  it('list output always carries the tags array', () => {
    const service = createService();
    service.create(projectId, { label: 'Untagged' });
    const listed = service.listByProject(projectId);
    expect(listed?.[0]?.tags).toEqual([]);
  });

  it('delete cascades the task-tag associations but keeps the tags', () => {
    const service = createService();
    const created = service.create(projectId, { label: 'Tagged', tags: ['keep'] });

    expect(service.delete(created?.id ?? '')).toBe(true);
    expect(listTags(db, projectId).map((tag) => tag.name)).toEqual(['keep']);
    expect(db.$client.prepare('SELECT COUNT(*) AS count FROM task_tags').get()).toEqual({
      count: 0,
    });
  });

  it('nextActionable with a tags filter only considers matching todo tasks (OR semantics)', () => {
    const service = createService();
    const done = createTask(db, { projectId, label: 'Done prereq', status: 'done' });
    const frontend = service.create(projectId, { label: 'Frontend', tags: ['frontend'] });
    const backend = service.create(projectId, { label: 'Backend', tags: ['backend'] });
    createEdge(db, {
      projectId,
      fromTaskId: done.id,
      toTaskId: frontend?.id ?? '',
      label: 'blocks',
    });

    const unfiltered = service.nextActionable(projectId);
    expect(unfiltered?.next_task?.id).toBe(frontend?.id);

    const backendOnly = service.nextActionable(projectId, { tags: ['backend'] });
    expect(backendOnly?.next_task?.id).toBe(backend?.id);
    expect(backendOnly?.next_task?.tags?.map((tag) => tag.name)).toEqual(['backend']);

    const either = service.nextActionable(projectId, { tags: ['backend', 'frontend'] });
    expect(either?.next_task?.id).toBe(frontend?.id);

    const none = service.nextActionable(projectId, { tags: ['missing'] });
    expect(none).toEqual({ next_task: null, reason: 'no_todo_tasks', blocked: [] });
  });

  it('nextActionable tags filter keeps prerequisite evaluation across all tasks', () => {
    const service = createService();
    const prereq = service.create(projectId, { label: 'Untagged prereq', status: 'todo' });
    const tagged = service.create(projectId, { label: 'Tagged dependent', tags: ['x'] });
    createEdge(db, {
      projectId,
      fromTaskId: prereq?.id ?? '',
      toTaskId: tagged?.id ?? '',
      label: 'blocks',
    });

    const result = service.nextActionable(projectId, { tags: ['x'] });
    expect(result?.next_task).toBeNull();
    expect(result?.reason).toBe('all_blocked');
    expect(result?.blocked[0]?.task.id).toBe(tagged?.id);
    expect(result?.blocked[0]?.waiting_on.map((task) => task.id)).toEqual([prereq?.id]);
  });
});
