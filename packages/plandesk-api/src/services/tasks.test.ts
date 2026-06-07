import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  createProject,
  createTask,
  InvalidTaskStatusError,
  listTasks,
  migrate,
} from '@plandesk/db';
import { createTaskService } from './tasks.js';

describe('taskService', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM projects');
    projectId = createProject(db, { name: 'Project' }).id;
  });

  it('lists tasks for a project with optional status filter', () => {
    const service = createTaskService({ db });
    createTask(db, { projectId, label: 'Todo', status: 'todo' });
    createTask(db, { projectId, label: 'Done', status: 'done' });

    expect(service.listByProject(projectId)).toHaveLength(2);
    const filtered = service.listByProject(projectId, { status: 'todo' });
    expect(filtered).toEqual([expect.objectContaining({ status: 'todo' })]);
    expect(listTasks(db, projectId, { status: 'done' })).toHaveLength(1);
  });

  it('returns undefined when the project is missing', () => {
    const service = createTaskService({ db });
    expect(service.listByProject('00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('rejects an invalid status filter', () => {
    const service = createTaskService({ db });
    expect(() => service.listByProject(projectId, { status: 'invalid' })).toThrow(
      InvalidTaskStatusError,
    );
  });

  it('updates a task and bumps updated_at in serialized output', () => {
    const service = createTaskService({ db });
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

  it('returns undefined when updating a missing task', () => {
    const service = createTaskService({ db });
    expect(
      service.update('00000000-0000-4000-8000-000000009999', { status: 'done' }),
    ).toBeUndefined();
  });
});
