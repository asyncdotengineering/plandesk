import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSyncToken, hashToken } from './auth.js';
import { createSyncServer } from './app.js';
import { createSyncDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { hostedShares, projectionBlobs } from './db/schema.js';

function generateShareToken(): string {
  return `plandesk_share_${randomBytes(32).toString('base64url')}`;
}

function createTestApp() {
  const db = createSyncDb(':memory:');
  migrate(db);
  const { token: syncToken } = createSyncToken(db, { label: 'test' });
  const app = createSyncServer({ db });
  return { app, db, syncToken };
}

const sampleView = {
  project: { global_id: 'gid-1', name: 'Portal Project', updated_at: '2026-01-01T00:00:00.000Z' },
  tasks: [{ id: 't1', label: 'Task', status: 'todo', position: 0 }],
  edges: [],
  documents: [],
  progress: { todo: 1, in_progress: 0, done: 0 },
};

async function pushProjection(
  app: ReturnType<typeof createSyncServer>,
  syncToken: string,
  gid: string,
  shareToken: string,
  view: unknown = sampleView,
  version = 1,
) {
  return app.request(`/api/sync/v1/projects/${gid}/projection`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      share: {
        token_hash: hashToken(shareToken),
        audience_name: 'Acme Corp',
        permissions: { read: true, submit: false },
        expires_at: null,
      },
      version,
      view,
    }),
  });
}

describe('createSyncServer', () => {
  it('PUT projection returns 401 without Authorization', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/sync/v1/projects/gid-1/projection', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share: {}, version: 1, view: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT projection returns 401 for invalid sync token', async () => {
    const { app } = createTestApp();
    const res = await pushProjection(app, 'plandesk_sync_invalid', 'gid-1', generateShareToken());
    expect(res.status).toBe(401);
  });

  it('PUT projection stores share and blob; GET view returns projection', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    const putRes = await pushProjection(app, syncToken, 'gid-1', shareToken);
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ ok: true });

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as Record<string, unknown>;
    expect(payload['project']).toEqual(sampleView.project);
    expect(payload['audience_name']).toBe('Acme Corp');
    expect(payload['permissions']).toEqual({ read: true, submit: false });
  });

  it('GET view returns 404 when share exists but no projection blob', async () => {
    const { app, db, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    const tokenHash = hashToken(shareToken);

    const putRes = await pushProjection(app, syncToken, 'gid-1', shareToken);
    expect(putRes.status).toBe(200);

    const share = db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, tokenHash))
      .get();
    expect(share).toBeDefined();
    if (share === undefined) {
      throw new Error('expected share row');
    }

    db.delete(projectionBlobs).where(eq(projectionBlobs.shareId, share.id)).run();

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(404);
  });

  it('GET view returns 401 for unknown share token', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/api/portal/v1/shares/${generateShareToken()}/view`);
    expect(res.status).toBe(401);
  });

  it('GET view returns 401 for expired share', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    const past = new Date(Date.now() - 60_000).toISOString();

    const putRes = await app.request('/api/sync/v1/projects/gid-1/projection', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        share: {
          token_hash: hashToken(shareToken),
          audience_name: 'Expired',
          permissions: { read: true },
          expires_at: past,
        },
        version: 1,
        view: sampleView,
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(401);
  });

  it('POST revoke then GET view returns 401', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const revokeRes = await app.request(`/api/sync/v1/shares/${shareToken}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${syncToken}` },
    });
    expect(revokeRes.status).toBe(200);

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(401);
  });

  it('POST revoke returns 401 without sync token', async () => {
    const { app } = createTestApp();
    const res = await app.request(`/api/sync/v1/shares/${generateShareToken()}/revoke`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('PUT projection upserts share and updates version', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1);
    const updatedView = { ...sampleView, progress: { todo: 0, in_progress: 1, done: 0 } };
    await pushProjection(app, syncToken, 'gid-1', shareToken, updatedView, 2);

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as { progress: { in_progress: number } };
    expect(payload.progress.in_progress).toBe(1);
  });

  it('revoked share can be reactivated by push clearing revoked_at', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    await app.request(`/api/sync/v1/shares/${shareToken}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${syncToken}` },
    });

    const revokedGet = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(revokedGet.status).toBe(401);

    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 2);
    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(200);
  });

  it('stores token hashes at rest, not raw tokens', async () => {
    const { app, db, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const rows = db.$client.prepare('SELECT token_hash FROM hosted_shares').all() as Array<{
      token_hash: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashToken(shareToken));
    expect(rows[0]?.token_hash).not.toBe(shareToken);

    const syncRows = db.$client.prepare('SELECT token_hash FROM sync_tokens').all() as Array<{
      token_hash: string;
    }>;
    expect(syncRows[0]?.token_hash).toBe(hashToken(syncToken));
    expect(syncRows[0]?.token_hash).not.toBe(syncToken);
  });

  it('portal endpoints send CORS headers; sync endpoints do not', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const portalRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`, {
      headers: { Origin: 'http://localhost:5174' },
    });
    expect(portalRes.headers.get('access-control-allow-origin')).toBe('*');

    const syncRes = await app.request('/api/sync/v1/projects/gid-1/projection', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5174' },
    });
    expect(syncRes.headers.get('access-control-allow-origin')).toBeNull();
  });
});
