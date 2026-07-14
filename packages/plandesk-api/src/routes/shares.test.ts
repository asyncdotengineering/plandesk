import { describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createProjectInDefaultOrg as createProject,
  ensureDefaultOrg,
  migrate,
  type Db,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createServices } from '../services/index.js';
import { createApp } from '../server.js';

async function createTestAppWithServices() {
  const db = await createDb(':memory:');
  await migrate(db);
  const org = await ensureDefaultOrg(db);
  const services = createServices({ db, orgId: org.id });
  return { app: createApp({ db, services }), db, services, orgId: org.id };
}

describe('shares routes', () => {
  it('serves markdown for a resource share token', async () => {
    const { app, db, services } = await createTestAppWithServices();

    const project = await createProject(db, { name: 'Share route' });
    const task = await createTask(db, { projectId: project.id, label: 'Ship it', status: 'todo' });
    await createDocument(db, {
      projectId: project.id,
      title: 'Spec',
      body: '<p>Body</p>',
      linkedTaskId: task.id,
    });

    const created = await services.shareService.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'http://localhost:3000',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }

    const mdPath = created.markdownUrl.slice('http://localhost:3000'.length);
    const res = await app.request(mdPath);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('Ship it');
    expect(body).toContain('## Linked document: Spec');
  });

  it('returns 404 for an unknown token and 410 for a revoked one', async () => {
    const { app, db, services } = await createTestAppWithServices();

    const project = await createProject(db, { name: 'Share route gone' });
    const task = await createTask(db, { projectId: project.id, label: 'Revoke target', status: 'todo' });

    const created = await services.shareService.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'http://localhost:3000',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }
    const share = (await services.shareService.listShares(project.id))?.[0];
    if (!share) {
      throw new Error('expected share row');
    }
    expect(await services.shareService.revokeShare(share.id)).toBe(true);

    const mdPath = created.markdownUrl.slice('http://localhost:3000'.length);
    const revokedRes = await app.request(mdPath);
    expect(revokedRes.status).toBe(410);

    const missingRes = await app.request('/api/v1/share/plandesk_share_unknown.md');
    expect(missingRes.status).toBe(404);
  });

  it('404s a share path without a .md extension', async () => {
    const { app } = await createTestAppWithServices();
    const res = await app.request('/api/v1/share/plandesk_share_abc');
    expect(res.status).toBe(404);
  });

  it('POST /tasks/:id/share mints a public markdown link the .md route then serves', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'UI share' });
    const task = await createTask(db, { projectId: project.id, label: 'Shareable task', status: 'todo' });

    const res = await app.request(`/api/v1/tasks/${task.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: '7d' }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { url: string; markdown_url: string; expires_at: string | null };
    expect(json.markdown_url).toContain('/api/v1/share/');
    expect(json.markdown_url.endsWith('.md')).toBe(true);
    expect(json.expires_at).not.toBeNull(); // 7d → a real expiry

    // The minted link resolves through the existing .md route.
    const mdPath = new URL(json.markdown_url).pathname;
    const md = await app.request(mdPath);
    expect(md.status).toBe(200);
    expect(await md.text()).toContain('Shareable task');
  });

  it('POST /documents/:id/share supports never-expiring links; 404s a missing resource; 400s a bad TTL', async () => {
    const { app, db } = await createTestAppWithServices();
    const project = await createProject(db, { name: 'UI share doc' });
    const doc = await createDocument(db, { projectId: project.id, title: 'Design', body: '<p>x</p>' });

    const never = await app.request(`/api/v1/documents/${doc.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: 'never' }),
    });
    expect(never.status).toBe(201);
    expect(((await never.json()) as { expires_at: string | null }).expires_at).toBeNull();

    const missing = await app.request('/api/v1/tasks/nope/share', { method: 'POST' });
    expect(missing.status).toBe(404);

    const bad = await app.request(`/api/v1/documents/${doc.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires: 'forever' }),
    });
    expect(bad.status).toBe(400);
  });
});
