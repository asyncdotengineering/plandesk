import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import { getTask, InvalidTaskStatusError, listTasks, updateTask } from './tasks.js';

describe('tasks repository', () => {
  const db = createDb(':memory:');
  let projectId = '';

  beforeEach(() => {
    migrate(db);
    db.$client.exec('DELETE FROM tasks');
    db.$client.exec('DELETE FROM goals');
    db.$client.exec('DELETE FROM projects');
    const project = createProject(db, { name: 'Test Project' });
    projectId = project.id;
  });

  it('creates and retrieves a task with REQ-4 fields', () => {
    const dueDate = new Date('2026-12-31T00:00:00.000Z');
    const created = createTask(db, {
      projectId,
      label: 'Implement auth',
      status: 'in_progress',
      description: 'OAuth flow',
      assignee: 'dev@example.com',
      dueDate,
      x: 120,
      y: 48,
    });
    const fetched = getTask(db, created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.status).toBe('in_progress');
    expect(fetched?.assignee).toBe('dev@example.com');
    expect(fetched?.dueDate?.toISOString()).toBe(dueDate.toISOString());
  });

  it('returns undefined for a missing task', () => {
    expect(getTask(db, '00000000-0000-4000-8000-000000009999')).toBeUndefined();
  });

  it('lists tasks for a project', () => {
    createTask(db, { projectId, label: 'One' });
    createTask(db, { projectId, label: 'Two' });
    const tasks = listTasks(db, projectId);
    expect(tasks).toHaveLength(2);
  });

  it('lists tasks filtered by status', () => {
    createTask(db, { projectId, label: 'Todo', status: 'todo' });
    createTask(db, { projectId, label: 'Done', status: 'done' });
    expect(listTasks(db, projectId, { status: 'todo' })).toHaveLength(1);
    expect(listTasks(db, projectId, { status: 'done' })[0]?.status).toBe('done');
  });

  it('rejects an invalid status on create', () => {
    expect(() =>
      createTask(db, {
        projectId,
        label: 'Bad status',
        status: 'invalid' as 'todo',
      }),
    ).toThrow(InvalidTaskStatusError);
  });

  it('rejects an invalid status on update', () => {
    const task = createTask(db, { projectId, label: 'Task' });
    expect(() => updateTask(db, task.id, { status: 'invalid' as 'todo' })).toThrow(
      InvalidTaskStatusError,
    );
  });

  it('updates a task and bumps updated_at', () => {
    const created = createTask(db, { projectId, label: 'Before', status: 'todo' });
    const updated = updateTask(db, created.id, { status: 'done', label: 'After' });
    expect(updated?.status).toBe('done');
    expect(updated?.label).toBe('After');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });
});
