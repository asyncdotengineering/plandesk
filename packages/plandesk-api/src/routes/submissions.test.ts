import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, createProject, migrate, upsertSubmission , type Db} from '@plandesk/db';
import { createApp } from '../server.js';
import { createEventBus } from '../events.js';
import { createServices, type Services } from '../services/index.js';
import { parseJson } from '../test-helpers.js';

const remote = {
  serverUrl: 'https://sync.example',
  globalProjectId: 'gid-1',
  syncToken: 'plandesk_sync_test',
};

async function createTestAppWithServices() {
  const db = await createDb(':memory:');
  await migrate(db);
  const eventBus = createEventBus();
  const services: Services = createServices({ db, eventBus });
  const app = createApp({ db, eventBus, services });
  return { app, db, services };
}

async function seedSubmission(db: Db, projectId: string) {
  await upsertSubmission(db, {
    id: 'sub-1',
    projectId,
    hostedShareId: 'hosted-share-1',
    participantName: 'Alex',
    title: 'Bug report',
    body: 'Something broke',
    severity: 'high',
    createdAt: new Date('2026-01-15T12:00:00.000Z'),
    pulledAt: new Date('2026-01-15T12:01:00.000Z'),
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submissions routes', () => {
  it('GET /projects/:id/submissions defaults to pending and 404s for missing project', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Inbox' });
    await seedSubmission(db, project.id);

    const res = await app.request(`/api/v1/projects/${project.id}/submissions`);
    expect(res.status).toBe(200);
    const body = await parseJson<Array<{ id: string; status: string }>>(res);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: 'sub-1', status: 'pending' });

    const missingRes = await app.request(
      '/api/v1/projects/00000000-0000-4000-8000-000000009999/submissions',
    );
    expect(missingRes.status).toBe(404);
  });

  it('GET supports an explicit status filter and rejects invalid ones', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Inbox filter' });
    await seedSubmission(db, project.id);

    const acceptedRes = await app.request(
      `/api/v1/projects/${project.id}/submissions?status=accepted`,
    );
    expect(acceptedRes.status).toBe(200);
    expect(await parseJson(acceptedRes)).toEqual([]);

    const invalidRes = await app.request(
      `/api/v1/projects/${project.id}/submissions?status=bogus`,
    );
    expect(invalidRes.status).toBe(400);
  });

  it('POST /submissions/:id/triage returns not_published when the project has no sync remote', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Unpublished' });
    await seedSubmission(db, project.id);

    const res = await app.request('/api/v1/submissions/sub-1/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept' }),
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'not_published' });
  });

  it('POST triage accept creates a scope task even if a different status is requested', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Accept' });
    await seedSubmission(db, project.id);
    services.syncService.setRemote(project.id, remote);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const res = await app.request('/api/v1/submissions/sub-1/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // as_task carries no status field in the wire type, but even a stray
      // extra field must not escape the server-side `scope` override.
      body: JSON.stringify({ action: 'accept', as_task: { label: 'Custom label' } }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<{ status: string; linked_task_id: string | null }>(res);
    expect(body.status).toBe('accepted');
    expect(body.linked_task_id).toBeTruthy();

    const tasksRes = await app.request(`/api/v1/projects/${project.id}/tasks?status=scope`);
    const tasks = await parseJson<Array<{ label: string; status: string }>>(tasksRes);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ label: 'Custom label', status: 'scope' });
  });

  it('POST triage reject marks the submission rejected', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Reject' });
    await seedSubmission(db, project.id);
    services.syncService.setRemote(project.id, remote);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const res = await app.request('/api/v1/submissions/sub-1/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    });

    expect(res.status).toBe(200);
    expect(await parseJson(res)).toMatchObject({ status: 'rejected', linked_task_id: null });
  });

  it('POST triage 400s on an invalid action and 404s on an unknown submission', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Invalid' });
    await seedSubmission(db, project.id);
    services.syncService.setRemote(project.id, remote);

    const invalidRes = await app.request('/api/v1/submissions/sub-1/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bogus' }),
    });
    expect(invalidRes.status).toBe(400);

    const missingRes = await app.request('/api/v1/submissions/does-not-exist/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept' }),
    });
    expect(missingRes.status).toBe(404);
  });

  it('POST triage accept with link_task_id links to an existing task and creates no new task', async () => {
    const { app, db, services } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'Merge' });
    await seedSubmission(db, project.id);
    await services.syncService.setRemote(project.id, remote);

    const existing = await services.taskService.create(project.id, {
      label: 'Existing task',
      status: 'scope',
      description: 'already here',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const res = await app.request('/api/v1/submissions/sub-1/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept', link_task_id: existing?.id }),
    });

    expect(res.status).toBe(200);
    const body = await parseJson<{ status: string; linked_task_id: string | null }>(res);
    expect(body.status).toBe('accepted');
    expect(body.linked_task_id).toBe(existing?.id);

    // The merge links to the existing task and does NOT create a duplicate scope task.
    const scopeRes = await app.request(`/api/v1/projects/${project.id}/tasks?status=scope`);
    const scopeTasks = await parseJson<Array<{ id: string }>>(scopeRes);
    expect(scopeTasks).toHaveLength(1);
    expect(scopeTasks[0]?.id).toBe(existing?.id);
  });
});
