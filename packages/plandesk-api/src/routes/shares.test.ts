import { describe, expect, it } from 'vitest';
import { createDb, createDocument, createProject, migrate } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { createServices } from '../services/index.js';
import { createApp } from '../server.js';

function createTestAppWithServices() {
  const db = createDb(':memory:');
  migrate(db);
  const services = createServices({ db });
  return { app: createApp({ db, services }), db, services };
}

describe('shares routes', () => {
  it('serves markdown for a resource share token', async () => {
    const { app, db, services } = createTestAppWithServices();

    const project = createProject(db, { name: 'Share route' });
    const task = createTask(db, { projectId: project.id, label: 'Ship it', status: 'todo' });
    createDocument(db, {
      projectId: project.id,
      title: 'Spec',
      body: '<p>Body</p>',
      linkedTaskId: task.id,
    });

    const created = services.shareService.createResourceShare(
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
    const { app, db, services } = createTestAppWithServices();

    const project = createProject(db, { name: 'Share route gone' });
    const task = createTask(db, { projectId: project.id, label: 'Revoke target', status: 'todo' });

    const created = services.shareService.createResourceShare(
      { resource: { kind: 'task', id: task.id } },
      'http://localhost:3000',
    );
    if (!created) {
      throw new Error('expected resource share to be created');
    }
    const share = services.shareService.listShares(project.id)?.[0];
    if (!share) {
      throw new Error('expected share row');
    }
    expect(services.shareService.revokeShare(share.id)).toBe(true);

    const mdPath = created.markdownUrl.slice('http://localhost:3000'.length);
    const revokedRes = await app.request(mdPath);
    expect(revokedRes.status).toBe(410);

    const missingRes = await app.request('/api/v1/share/plandesk_share_unknown.md');
    expect(missingRes.status).toBe(404);
  });

  it('404s a share path without a .md extension', async () => {
    const { app } = createTestAppWithServices();
    const res = await app.request('/api/v1/share/plandesk_share_abc');
    expect(res.status).toBe(404);
  });
});
