import { describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createToken,
  ensureDefaultOrg,
} from '@plandesk/db';
import { createTestApp, parseJson } from './test-helpers.js';

describe('org tenancy', () => {
  it('test:cross_org_denied — org-B token requesting org-A project returns 404 on REST', async () => {
    const { app, db } = await createTestApp();
    const orgA = await ensureDefaultOrg(db);
    const orgB = await createOrg(db, { name: 'Org B' });

    const projectA = await createProject(db, {
      name: 'A Project',
      orgId: orgA.id,
    });
    const tokenB = await createToken(db, { name: 'B token', orgId: orgB.id, scope: 'full' });

    const res = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Authorization: `Bearer ${tokenB.token}` },
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('test:local_mode_unchanged — loopback single-org works without a token', async () => {
    const { app } = await createTestApp({ bindHost: '127.0.0.1' });

    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local Project' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{ id: string; name: string }>(createRes);
    expect(created.name).toBe('Local Project');

    const listRes = await app.request('/api/v1/projects');
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string }>>(listRes);
    expect(listed.some((p) => p.id === created.id)).toBe(true);

    const getRes = await app.request(`/api/v1/projects/${created.id}`);
    expect(getRes.status).toBe(200);
  });

  it('rejects a read-only token on a write route with 403', async () => {
    const { app, db, orgId } = await createTestApp();
    const token = await createToken(db, {
      name: 'ro',
      orgId,
      scope: 'read-only',
    });

    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify({ name: 'Should Fail' }),
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });

  it('requires a token when bound to non-loopback even with a single org', async () => {
    const { app } = await createTestApp({ bindHost: '0.0.0.0' });
    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });
});
