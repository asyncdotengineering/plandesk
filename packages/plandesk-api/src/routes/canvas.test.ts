import { describe, expect, it } from 'vitest';
import { createEdge, createProjectInDefaultOrg as createProject, getTask } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
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
    const { app } = await createTestApp();
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
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Concurrency' });
    const task = await createTask(db, {
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

    const persisted = await getTask(db, task.id);
    expect(persisted?.status).toBe('in_progress');
    expect(persisted?.label).toBe('Agent task');
    expect(persisted?.x).toBe(500);
    expect(persisted?.y).toBe(600);
  });

  it('PUT /canvas returns 400 when edge references a missing task', async () => {
    const { app } = await createTestApp();
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
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/canvas');
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PUT /canvas returns 404 for missing project', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/projects/00000000-0000-4000-8000-000000009999/canvas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [], edges: [] }),
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PUT /canvas returns 400 for invalid payload shape', async () => {
    const { app } = await createTestApp();
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
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Edge delete' });
    const taskA = await createTask(db, { projectId: project.id, label: 'A' });
    const taskB = await createTask(db, { projectId: project.id, label: 'B' });
    const edge = await createEdge(db, {
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
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Missing edge' });

    const res = await app.request(
      `/api/v1/projects/${project.id}/edges/00000000-0000-4000-8000-000000009999`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });

  it('GET /projects/:id/edges lists edges with from/to/label (#29)', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Edge list' });
    const taskA = await createTask(db, { projectId: project.id, label: 'A' });
    const taskB = await createTask(db, { projectId: project.id, label: 'B' });
    const edge = await createEdge(db, {
      projectId: project.id,
      fromTaskId: taskA.id,
      toTaskId: taskB.id,
      label: 'blocks',
    });

    const res = await app.request(`/api/v1/projects/${project.id}/edges`);
    expect(res.status).toBe(200);
    const edges = await parseJson<Array<{ id: string; from_task_id: string; to_task_id: string; label: string | null }>>(res);
    expect(edges).toEqual([
      expect.objectContaining({ id: edge.id, from_task_id: taskA.id, to_task_id: taskB.id, label: 'blocks' }),
    ]);
  });

  it('GET /projects/:id/edges returns 404 for missing project', async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/api/v1/projects/00000000-0000-4000-8000-000000009999/edges`);
    expect(res.status).toBe(404);
  });

  it('POST /projects/:id/edges creates a task→document edge and document reports the link', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Edge create' });
    const task = await createTask(db, { projectId: project.id, label: 'Task' });
    const docRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Spec' }),
    });
    const doc = await parseJson<{ id: string }>(docRes);

    const res = await app.request(`/api/v1/projects/${project.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_type: 'task',
        from_id: task.id,
        to_type: 'document',
        to_id: doc.id,
        label: 'documents',
      }),
    });
    expect(res.status).toBe(201);
    const edge = await parseJson<{
      id: string;
      from_type: string;
      from_id: string;
      to_type: string;
      to_id: string;
      label: string | null;
    }>(res);
    expect(edge).toMatchObject({
      id: expect.any(String),
      from_type: 'task',
      from_id: task.id,
      to_type: 'document',
      to_id: doc.id,
      label: 'documents',
    });

    const docGet = await parseJson<{
      links: Array<{ type: string; id: string; title: string; label: string | null; edge_id: string }>;
      backlinks: Array<{ type: string; id: string; title: string; label: string | null; edge_id: string }>;
    }>(await app.request(`/api/v1/documents/${doc.id}`));
    expect(docGet.backlinks).toEqual([
      {
        type: 'task',
        id: task.id,
        title: 'Task',
        label: 'documents',
        edge_id: edge.id,
      },
    ]);
  });

  it('POST /projects/:id/edges accepts task-shaped body', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Task-shaped' });
    const a = await createTask(db, { projectId: project.id, label: 'A' });
    const b = await createTask(db, { projectId: project.id, label: 'B' });

    const res = await app.request(`/api/v1/projects/${project.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_task_id: a.id,
        to_task_id: b.id,
        label: 'blocks',
      }),
    });
    expect(res.status).toBe(201);
    const edge = await parseJson<{
      from_type: string;
      from_id: string;
      to_type: string;
      to_id: string;
      from_task_id: string;
      to_task_id: string;
    }>(res);
    expect(edge).toMatchObject({
      from_type: 'task',
      from_id: a.id,
      to_type: 'task',
      to_id: b.id,
      from_task_id: a.id,
      to_task_id: b.id,
    });
  });

  it('POST refuses a document endpoint in another project', async () => {
    const { app, db } = await createTestApp();
    const projectA = await createProject(db, { name: 'Project A' });
    const projectB = await createProject(db, { name: 'Project B' });
    const taskA = await createTask(db, { projectId: projectA.id, label: 'A task' });
    const docBRes = await app.request(`/api/v1/projects/${projectB.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'B doc' }),
    });
    const docB = await parseJson<{ id: string }>(docBRes);

    const res = await app.request(`/api/v1/projects/${projectA.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_type: 'task',
        from_id: taskA.id,
        to_type: 'document',
        to_id: docB.id,
      }),
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('POST refuses a task endpoint in another project', async () => {
    const { app, db } = await createTestApp();
    const projectA = await createProject(db, { name: 'Project A' });
    const projectB = await createProject(db, { name: 'Project B' });
    const taskA = await createTask(db, { projectId: projectA.id, label: 'A task' });
    const taskB = await createTask(db, { projectId: projectB.id, label: 'B task' });

    const res = await app.request(`/api/v1/projects/${projectA.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_type: 'task',
        from_id: taskA.id,
        to_type: 'task',
        to_id: taskB.id,
      }),
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('POST refuses an id whose real type differs from the claimed type', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Type mismatch' });
    const task = await createTask(db, { projectId: project.id, label: 'Real task' });
    const docRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Real doc' }),
    });
    const doc = await parseJson<{ id: string }>(docRes);

    // Task id claimed as document.
    const asDoc = await app.request(`/api/v1/projects/${project.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_type: 'task',
        from_id: task.id,
        to_type: 'document',
        to_id: task.id,
      }),
    });
    expect(asDoc.status).toBe(400);
    expect(await parseJson(asDoc)).toEqual({ error: 'invalid_argument' });

    // Document id claimed as task.
    const asTask = await app.request(`/api/v1/projects/${project.id}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_type: 'document',
        from_id: doc.id,
        to_type: 'task',
        to_id: doc.id,
      }),
    });
    expect(asTask.status).toBe(400);
    expect(await parseJson(asTask)).toEqual({ error: 'invalid_argument' });
  });

  it('links carry edge_id; DELETE by that id removes only that edge', async () => {
    const { app, db } = await createTestApp();
    const project = await createProject(db, { name: 'Sibling edges' });
    const task = await createTask(db, { projectId: project.id, label: 'Shared' });
    const docRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hub' }),
    });
    const doc = await parseJson<{ id: string }>(docRes);

    const first = await parseJson<{ id: string }>(
      await app.request(`/api/v1/projects/${project.id}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_type: 'document',
          from_id: doc.id,
          to_type: 'task',
          to_id: task.id,
          label: 'documents',
        }),
      }),
    );
    const second = await parseJson<{ id: string }>(
      await app.request(`/api/v1/projects/${project.id}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_type: 'document',
          from_id: doc.id,
          to_type: 'task',
          to_id: task.id,
          label: 'references',
        }),
      }),
    );
    expect(first.id).not.toBe(second.id);

    const before = await parseJson<{
      links: Array<{ edge_id: string; label: string | null }>;
    }>(await app.request(`/api/v1/documents/${doc.id}`));
    expect(before.links).toHaveLength(2);
    expect(before.links.map((l) => l.edge_id).sort()).toEqual([first.id, second.id].sort());

    const del = await app.request(`/api/v1/projects/${project.id}/edges/${first.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);

    const after = await parseJson<{
      links: Array<{ edge_id: string; label: string | null }>;
    }>(await app.request(`/api/v1/documents/${doc.id}`));
    expect(after.links).toEqual([
      expect.objectContaining({ edge_id: second.id, label: 'references' }),
    ]);
  });
});
