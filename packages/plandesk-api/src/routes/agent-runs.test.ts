import { describe, expect, it } from 'vitest';
import { createServices } from '../services/index.js';
import { createTestApp, parseJson } from '../test-helpers.js';

type AgentRunEventResponse = {
  id: string;
  message: string;
  created_at: string;
};

type AgentRunResponse = {
  id: string;
  project_id: string;
  status: string;
  label: string | null;
  started_at: string;
  completed_at: string | null;
  events: AgentRunEventResponse[];
};

describe('agent-runs routes', () => {
  it('GET /projects/:id/agent-runs returns runs with nested events', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });

    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Agents' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);

    const otherProjectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other' }),
    });
    const otherProject = await parseJson<{ id: string }>(otherProjectRes);

    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }
    await agentRunService.recordProgress(run.id, 'Planning');
    await agentRunService.complete(run.id, 'completed');
    await agentRunService.start(otherProject.id, 'Other run');

    const listRes = await app.request(`/api/v1/projects/${project.id}/agent-runs`);
    expect(listRes.status).toBe(200);
    const runs = await parseJson<AgentRunResponse[]>(listRes);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: run.id,
      project_id: project.id,
      status: 'completed',
      label: 'Worker',
    });
    expect(runs[0]?.events).toHaveLength(1);
    expect(runs[0]?.events[0]).toMatchObject({ message: 'Planning' });
    expect(runs[0]?.events[0]).not.toHaveProperty('run_id');
  });

  it('returns 404 for a missing project', async () => {
    const { app } = await createTestApp();
    const res = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/agent-runs',
    );
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('GET /projects/:id/agent-runs honors limit and offset', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Paginate runs' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    await agentRunService.start(project.id, 'Run 1');
    await agentRunService.start(project.id, 'Run 2');

    const res = await app.request(`/api/v1/projects/${project.id}/agent-runs?limit=1&offset=0`);
    expect(res.status).toBe(200);
    const runs = await parseJson<AgentRunResponse[]>(res);
    expect(runs).toHaveLength(1);
  });

  it('GET /projects/:id/agent-runs returns 400 for invalid pagination', async () => {
    const { app } = await createTestApp();
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad pagination' }),
      }),
    );

    const res = await app.request(`/api/v1/projects/${project.id}/agent-runs?limit=bad`);
    expect(res.status).toBe(400);
  });

  it('POST /agent-runs/:id/progress records an event on a running run', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Progress' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }

    const res = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'checkpoint (hook)' }),
    });
    expect(res.status).toBe(201);
    const event = await parseJson<AgentRunEventResponse>(res);
    expect(event).toMatchObject({ run_id: run.id, message: 'checkpoint (hook)' });

    const runsRes = await app.request(`/api/v1/projects/${project.id}/agent-runs`);
    const runs = await parseJson<AgentRunResponse[]>(runsRes);
    expect(runs[0]?.events).toHaveLength(1);
    expect(runs[0]?.events[0]).toMatchObject({ message: 'checkpoint (hook)' });
  });

  it('POST /agent-runs/:id/progress returns 404 for an unknown run', async () => {
    const { app } = await createTestApp();
    const res = await app.request(
      '/api/v1/agent-runs/00000000-0000-4000-8000-000000009999/progress',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'checkpoint' }),
      },
    );
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('POST /agent-runs/:id/progress returns 400 for a missing message', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing message' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }

    const res = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /agent-runs/:id/progress returns 400 for a completed run', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Terminal run' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }
    await agentRunService.complete(run.id, 'completed');

    const res = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'too late' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /projects/:id/agent-runs starts a run and lists it', async () => {
    const { app } = await createTestApp();
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Start over HTTP' }),
      }),
    );

    const res = await app.request(`/api/v1/projects/${project.id}/agent-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'runner' }),
    });
    expect(res.status).toBe(201);
    const run = await parseJson<AgentRunResponse>(res);
    expect(run).toMatchObject({
      project_id: project.id,
      status: 'running',
      label: 'runner',
      completed_at: null,
    });

    const listed = await parseJson<AgentRunResponse[]>(
      await app.request(`/api/v1/projects/${project.id}/agent-runs`),
    );
    expect(listed.map((entry) => entry.id)).toContain(run.id);
  });

  it('POST /projects/:id/agent-runs accepts an absent body and stores a null label', async () => {
    const { app } = await createTestApp();
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No label' }),
      }),
    );

    const res = await app.request(`/api/v1/projects/${project.id}/agent-runs`, {
      method: 'POST',
    });
    expect(res.status).toBe(201);
    expect(await parseJson<AgentRunResponse>(res)).toMatchObject({ label: null });
  });

  it('POST /projects/:id/agent-runs returns 400 for a non-string label', async () => {
    const { app } = await createTestApp();
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad label' }),
      }),
    );

    const res = await app.request(`/api/v1/projects/${project.id}/agent-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /projects/:id/agent-runs returns 404 for a project outside the caller scope', async () => {
    const { app } = await createTestApp();
    const res = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/agent-runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'nowhere' }),
      },
    );
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PATCH /agent-runs/:id completes a running run', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Complete over HTTP' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }

    const res = await app.request(`/api/v1/agent-runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(res.status).toBe(200);
    const completed = await parseJson<AgentRunResponse>(res);
    expect(completed).toMatchObject({ id: run.id, status: 'completed' });
    expect(completed.completed_at).not.toBeNull();
  });

  it('PATCH /agent-runs/:id accepts failed', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Failed run' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }

    const res = await app.request(`/api/v1/agent-runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed' }),
    });
    expect(res.status).toBe(200);
    expect(await parseJson<AgentRunResponse>(res)).toMatchObject({ status: 'failed' });
  });

  it('PATCH /agent-runs/:id returns 400 for a status outside the terminal pair', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad status' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }

    for (const status of ['running', 'cancelled', '']) {
      const res = await app.request(`/api/v1/agent-runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      expect(res.status).toBe(400);
    }

    const missing = await app.request(`/api/v1/agent-runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
  });

  it('PATCH /agent-runs/:id returns 404 for an unknown run', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/agent-runs/00000000-0000-4000-8000-000000009999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('PATCH /agent-runs/:id returns 400 for an already-completed run', async () => {
    const { app, db, orgId } = await createTestApp();
    const { agentRunService } = createServices({ db, orgId });
    const project = await parseJson<{ id: string }>(
      await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Double complete' }),
      }),
    );
    const run = await agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }
    await agentRunService.complete(run.id, 'completed');

    const res = await app.request(`/api/v1/agent-runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed' }),
    });
    expect(res.status).toBe(400);
  });
});
