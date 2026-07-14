import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../client.js';
import { migrate } from '../migrate.js';
import { createProject } from './projects.js';
import { createTaskWithDefaultGoal as createTask } from '../testing.js';
import { getTask, InvalidTaskStatusError, listTasks, updateTask } from './tasks.js';

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
});
