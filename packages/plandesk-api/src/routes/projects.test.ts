import { describe, expect, it } from 'vitest';
import { createEdge, createProject, getTask, listEdges } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import {
  createTestApp,
  parseJson,
  type ProjectDetailResponse,
  type ProjectResponse,
  type TaskResponse,
} from '../test-helpers.js';

describe('projects routes', () => {
  it('POST /api/v1/projects creates a project', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project', description: 'Desc' }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<ProjectResponse>(res);
    expect(body.name).toBe('New Project');
    expect(body.description).toBe('Desc');
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('POST /api/v1/projects rejects missing name', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'No name' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('GET /api/v1/projects lists projects', async () => {
    const { app } = createTestApp();
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Listed' }),
    });

    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse[]>(res);
    expect(body).toHaveLength(1);
    expect(body[0]?.name).toBe('Listed');
  });

  it('GET /api/v1/projects/:id returns detail with summary counts', async () => {
    const { app, db } = createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Detail' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);
    createTask(db, { projectId: created.id, label: 'T1', status: 'todo' });
    createTask(db, { projectId: created.id, label: 'T2', status: 'done' });

    const res = await app.request(`/api/v1/projects/${created.id}`);
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectDetailResponse>(res);
    expect(body.summary).toEqual({
      scope: 0,
      todo: 1,
      in_progress: 0,
      done: 1,
      backlog: 0,
    });
  });

  it('GET /api/v1/projects/:id returns 404 when missing', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999');
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('GET /api/v1/projects/:id/tasks lists tasks with status filter', async () => {
    const { app, db } = createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tasks' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);
    createTask(db, { projectId: created.id, label: 'Todo', status: 'todo' });
    createTask(db, { projectId: created.id, label: 'Done', status: 'done' });

    const allRes = await app.request(`/api/v1/projects/${created.id}/tasks`);
    expect(allRes.status).toBe(200);
    expect(await parseJson<TaskResponse[]>(allRes)).toHaveLength(2);

    const filteredRes = await app.request(`/api/v1/projects/${created.id}/tasks?status=todo`);
    expect(filteredRes.status).toBe(200);
    const filtered = await parseJson<TaskResponse[]>(filteredRes);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe('todo');
  });

  it('GET /api/v1/projects/:id/tasks returns 404 for missing project', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/tasks');
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('GET /api/v1/projects/:id/tasks returns 400 for invalid status filter', async () => {
    const { app } = createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Filter' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}/tasks?status=invalid`);
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('POST /api/v1/projects/:id/tasks creates a task', async () => {
    const { app } = createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Task create' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'New task',
        status: 'todo',
        x: 1,
        y: 2,
        assignee: 'agent',
        due_date: '2026-12-01T00:00:00.000Z',
      }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<TaskResponse>(res);
    expect(body).toMatchObject({
      project_id: created.id,
      label: 'New task',
      status: 'todo',
      x: 1,
      y: 2,
      assignee: 'agent',
    });
  });

  it('POST /api/v1/projects/:id/tasks returns 400 for invalid status', async () => {
    const { app } = createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad status' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Task', status: 'invalid' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('POST /api/v1/projects/:id/tasks returns 404 for missing project', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/v1/projects/:id renames a project', async () => {
    const { app } = createTestApp();
    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Before' }),
    });
    const created = await parseJson<ProjectResponse>(createRes);

    const res = await app.request(`/api/v1/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'After', description: 'Updated' }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse>(res);
    expect(body.name).toBe('After');
    expect(body.description).toBe('Updated');
  });

  it('PATCH /api/v1/projects/:id returns 404 when missing', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/v1/projects/:id cascade deletes project data', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Delete me' });
    const task = createTask(db, { projectId: project.id, label: 'Task' });
    createTask(db, { projectId: project.id, label: 'Other' });

    const res = await app.request(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await app.request(`/api/v1/projects/${project.id}`);
    expect(getRes.status).toBe(404);

    const tasksRes = await app.request(`/api/v1/projects/${project.id}/tasks`);
    expect(tasksRes.status).toBe(404);
    expect(getTask(db, task.id)).toBeUndefined();
  });

  it('DELETE /api/v1/projects/:id returns 404 when missing', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/projects honors limit and offset', async () => {
    const { app } = createTestApp();
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A' }),
    });
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    });
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'C' }),
    });

    const res = await app.request('/api/v1/projects?limit=1&offset=1');
    expect(res.status).toBe(200);
    const body = await parseJson<ProjectResponse[]>(res);
    expect(body).toHaveLength(1);
  });

  it('GET /api/v1/projects returns 400 for invalid pagination', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects?limit=-1');
    expect(res.status).toBe(400);
  });
});

describe('tasks routes', () => {
  it('PATCH /api/v1/tasks/:id updates a task', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Patch' });
    const task = createTask(db, { projectId: project.id, label: 'Before', status: 'todo' });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'in_progress',
        label: 'After',
        description: 'Updated',
        x: 5,
        y: 6,
      }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<TaskResponse>(res);
    expect(body).toMatchObject({
      id: task.id,
      status: 'in_progress',
      label: 'After',
      description: 'Updated',
      x: 5,
      y: 6,
    });
    expect(body.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const listRes = await app.request(`/api/v1/projects/${project.id}/tasks?status=in_progress`);
    const listed = await parseJson<TaskResponse[]>(listRes);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(task.id);
  });

  it('PATCH /api/v1/tasks/:id returns 404 when missing', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/tasks/00000000-0000-4000-8000-000000009999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });

    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PATCH /api/v1/tasks/:id returns 400 for invalid status', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Invalid' });
    const task = createTask(db, { projectId: project.id, label: 'Task' });

    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('DELETE /api/v1/tasks/:id deletes task and cascades edges', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Delete task' });
    const task = createTask(db, { projectId: project.id, label: 'Task' });
    createEdge(db, {
      projectId: project.id,
      fromTaskId: task.id,
      toTaskId: task.id,
    });

    const res = await app.request(`/api/v1/tasks/${task.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(getTask(db, task.id)).toBeUndefined();
    expect(listEdges(db, project.id)).toHaveLength(0);
  });

  it('DELETE /api/v1/tasks/:id returns 404 when missing', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/tasks/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('GET /projects/:id/next-task returns the next actionable task', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Next task' });
    const blocker = createTask(db, { projectId: project.id, label: 'Blocker', status: 'todo' });
    const blocked = createTask(db, { projectId: project.id, label: 'Blocked', status: 'todo' });
    createEdge(db, {
      projectId: project.id,
      fromTaskId: blocker.id,
      toTaskId: blocked.id,
      label: 'blocks',
    });

    const res = await app.request(`/api/v1/projects/${project.id}/next-task`);
    expect(res.status).toBe(200);
    const body = await parseJson<{
      next_task: TaskResponse | null;
      reason: string;
      blocked: Array<{ task: TaskResponse; waiting_on: TaskResponse[] }>;
    }>(res);
    expect(body.next_task?.id).toBe(blocker.id);
    expect(body.reason).toBe('ok');
    expect(body.blocked).toHaveLength(1);
    expect(body.blocked[0]?.task.id).toBe(blocked.id);
  });

  it('GET /projects/:id/next-task returns 404 for a missing project', async () => {
    const { app } = createTestApp();
    const res = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/next-task',
    );
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });
});
