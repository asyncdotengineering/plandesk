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
    const { app, db, eventBus } = createTestApp();
    const { agentRunService } = createServices({ db, eventBus });

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

    const run = agentRunService.start(project.id, 'Worker');
    if (!run) {
      throw new Error('expected run');
    }
    agentRunService.recordProgress(run.id, 'Planning');
    agentRunService.complete(run.id, 'completed');
    agentRunService.start(otherProject.id, 'Other run');

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
    const { app } = createTestApp();
    const res = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/agent-runs',
    );
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('GET /projects/:id/agent-runs honors limit and offset', async () => {
    const { app, db, eventBus } = createTestApp();
    const { agentRunService } = createServices({ db, eventBus });
    const projectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Paginate runs' }),
    });
    const project = await parseJson<{ id: string }>(projectRes);
    agentRunService.start(project.id, 'Run 1');
    agentRunService.start(project.id, 'Run 2');

    const res = await app.request(`/api/v1/projects/${project.id}/agent-runs?limit=1&offset=0`);
    expect(res.status).toBe(200);
    const runs = await parseJson<AgentRunResponse[]>(res);
    expect(runs).toHaveLength(1);
  });

  it('GET /projects/:id/agent-runs returns 400 for invalid pagination', async () => {
    const { app } = createTestApp();
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
});
