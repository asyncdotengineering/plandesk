import { describe, expect, it } from 'vitest';
import { createEdge, createProject, createTask, getTask } from '@plandesk/db';
import { createTestApp, parseJson, type TaskResponse } from '../test-helpers.js';

type CanvasResponse = {
  nodes: TaskResponse[];
  edges: Array<{
    id: string;
    project_id: string;
    from_task_id: string;
    to_task_id: string;
    label: string | null;
    arrow_direction: string | null;
    style: string | null;
    created_at: string;
  }>;
  layout: unknown;
};

describe('canvas routes', () => {
  it('test:canvas_roundtrip persists nodes and labeled edges', async () => {
    const { app } = createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Roundtrip' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const nodeA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const nodeB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const nodeC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const edgeOne = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    const putPayload = {
      nodes: [
        { id: nodeA, label: 'Design', x: 10, y: 20 },
        { id: nodeB, label: 'Build', x: 100, y: 200 },
        { id: nodeC, label: 'Ship', x: 300, y: 400 },
      ],
      edges: [
        {
          id: edgeOne,
          from_task_id: nodeA,
          to_task_id: nodeB,
          label: 'blocks',
          arrow_direction: 'forward',
        },
        {
          from_task_id: nodeB,
          to_task_id: nodeC,
          label: 'depends_on',
        },
      ],
    };

    const putRes = await app.request(`/api/v1/projects/${project.id}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putPayload),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request(`/api/v1/projects/${project.id}/canvas`);
    expect(getRes.status).toBe(200);
    const canvas = await parseJson<CanvasResponse>(getRes);

    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.edges).toHaveLength(2);

    for (const node of putPayload.nodes) {
      const fetched = canvas.nodes.find((entry) => entry.id === node.id);
      expect(fetched).toMatchObject({
        label: node.label,
        x: node.x,
        y: node.y,
        status: 'todo',
      });
    }

    const labeledEdge = canvas.edges.find((edge) => edge.from_task_id === nodeA);
    expect(labeledEdge).toMatchObject({
      id: edgeOne,
      from_task_id: nodeA,
      to_task_id: nodeB,
      label: 'blocks',
      arrow_direction: 'forward',
    });

    const secondEdge = canvas.edges.find((edge) => edge.from_task_id === nodeB);
    expect(secondEdge).toMatchObject({
      from_task_id: nodeB,
      to_task_id: nodeC,
      label: 'depends_on',
    });
  });

  it('concurrency regression: layout PUT does not clobber PATCH status', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Concurrency' });
    const task = createTask(db, {
      projectId: project.id,
      label: 'Agent task',
      status: 'todo',
      x: 1,
      y: 2,
    });

    const patchRes = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(patchRes.status).toBe(200);

    const canvasPutRes = await app.request(`/api/v1/projects/${project.id}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [
          {
            id: task.id,
            x: 500,
            y: 600,
            label: 'Stale label from layout cache',
            status: 'todo',
          },
        ],
        edges: [],
      }),
    });
    expect(canvasPutRes.status).toBe(200);

    const taskRes = await app.request(`/api/v1/projects/${project.id}/tasks?status=in_progress`);
    const tasks = await parseJson<TaskResponse[]>(taskRes);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: task.id,
      status: 'in_progress',
      label: 'Agent task',
      x: 500,
      y: 600,
    });

    const persisted = getTask(db, task.id);
    expect(persisted?.status).toBe('in_progress');
    expect(persisted?.label).toBe('Agent task');
    expect(persisted?.x).toBe(500);
    expect(persisted?.y).toBe(600);
  });

  it('PUT /canvas returns 400 when edge references a missing task', async () => {
    const { app } = createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad edge' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const res = await app.request(`/api/v1/projects/${project.id}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [],
        edges: [
          {
            from_task_id: '00000000-0000-4000-8000-000000009999',
            to_task_id: '00000000-0000-4000-8000-000000009998',
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('GET /canvas returns 404 for missing project', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/canvas');
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PUT /canvas returns 404 for missing project', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/canvas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [], edges: [] }),
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PUT /canvas returns 400 for invalid payload shape', async () => {
    const { app } = createTestApp();
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invalid payload' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const res = await app.request(`/api/v1/projects/${project.id}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [{ x: 'bad', y: 1 }], edges: [] }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('DELETE /projects/:id/edges/:edgeId removes an edge', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Edge delete' });
    const taskA = createTask(db, { projectId: project.id, label: 'A' });
    const taskB = createTask(db, { projectId: project.id, label: 'B' });
    const edge = createEdge(db, {
      projectId: project.id,
      fromTaskId: taskA.id,
      toTaskId: taskB.id,
      label: 'blocks',
    });

    const res = await app.request(`/api/v1/projects/${project.id}/edges/${edge.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);

    const canvasRes = await app.request(`/api/v1/projects/${project.id}/canvas`);
    const canvas = await parseJson<CanvasResponse>(canvasRes);
    expect(canvas.edges).toHaveLength(0);
  });

  it('DELETE /projects/:id/edges/:edgeId returns 404 when missing', async () => {
    const { app, db } = createTestApp();
    const project = createProject(db, { name: 'Missing edge' });

    const res = await app.request(
      `/api/v1/projects/${project.id}/edges/00000000-0000-4000-8000-000000009999`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });
});
