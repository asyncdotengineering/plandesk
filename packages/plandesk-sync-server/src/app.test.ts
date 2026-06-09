import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSyncToken, hashToken } from './auth.js';
import { createSyncServer } from './app.js';
import { createSyncDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { activityLog, hostedShares, projectionBlobs } from './db/schema.js';

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

async function joinShare(
  app: ReturnType<typeof createSyncServer>,
  shareToken: string,
  name: string,
  email?: string,
) {
  return app.request(`/api/portal/v1/shares/${shareToken}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
}

async function viewWithSession(
  app: ReturnType<typeof createSyncServer>,
  shareToken: string,
  sessionToken: string,
  extraHeaders: Record<string, string> = {},
) {
  return app.request(`/api/portal/v1/shares/${shareToken}/view`, {
    headers: { Authorization: `Bearer ${sessionToken}`, ...extraHeaders },
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

  it('PUT projection stores share and blob; join + GET view returns projection', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    const putRes = await pushProjection(app, syncToken, 'gid-1', shareToken);
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ ok: true });

    const joinRes = await joinShare(app, shareToken, 'Alex');
    expect(joinRes.status).toBe(200);
    const joinPayload = (await joinRes.json()) as {
      session_token: string;
      participant: { id: string; name: string };
      share: { audience_name: string; permissions: Record<string, unknown> };
    };
    expect(joinPayload.participant.name).toBe('Alex');
    expect(joinPayload.share.audience_name).toBe('Acme Corp');
    expect(joinPayload.share.permissions).toEqual({ read: true, submit: false });

    const getRes = await viewWithSession(app, shareToken, joinPayload.session_token);
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as Record<string, unknown>;
    expect(payload['project']).toEqual(sampleView.project);
    expect(payload['audience_name']).toBe('Acme Corp');
    expect(payload['permissions']).toEqual({ read: true, submit: false });
  });

  it('GET view returns 401 without participant session', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(401);
  });

  it('GET view returns 401 for invalid participant session', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const getRes = await viewWithSession(app, shareToken, 'plandesk_pt_invalid');
    expect(getRes.status).toBe(401);
  });

  it('GET view returns 401 when session belongs to a different share', async () => {
    const { app, syncToken } = createTestApp();
    const shareTokenA = generateShareToken();
    const shareTokenB = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareTokenA);
    await pushProjection(app, syncToken, 'gid-2', shareTokenB);

    const joinRes = await joinShare(app, shareTokenA, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

    const getRes = await viewWithSession(app, shareTokenB, session_token);
    expect(getRes.status).toBe(401);
  });

  it('GET view returns 404 when share exists but no projection blob', async () => {
    const { app, db, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    const tokenHash = hashToken(shareToken);

    const putRes = await pushProjection(app, syncToken, 'gid-1', shareToken);
    expect(putRes.status).toBe(200);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

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

    const getRes = await viewWithSession(app, shareToken, session_token);
    expect(getRes.status).toBe(404);
  });

  it('GET view returns 401 for unknown share token', async () => {
    const { app } = createTestApp();
    const res = await viewWithSession(app, generateShareToken(), 'plandesk_pt_invalid');
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

    const joinRes = await joinShare(app, shareToken, 'Alex');
    expect(joinRes.status).toBe(401);

    const getRes = await viewWithSession(app, shareToken, 'plandesk_pt_any');
    expect(getRes.status).toBe(401);
  });

  it('POST revoke then GET view returns 401', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

    const revokeRes = await app.request(`/api/sync/v1/shares/${shareToken}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${syncToken}` },
    });
    expect(revokeRes.status).toBe(200);

    const getRes = await viewWithSession(app, shareToken, session_token);
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

    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

    const getRes = await viewWithSession(app, shareToken, session_token);
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as { progress: { in_progress: number } };
    expect(payload.progress.in_progress).toBe(1);
  });

  it('revoked share can be reactivated by push clearing revoked_at', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

    await app.request(`/api/sync/v1/shares/${shareToken}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${syncToken}` },
    });

    const revokedGet = await viewWithSession(app, shareToken, session_token);
    expect(revokedGet.status).toBe(401);

    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 2);
    const getRes = await viewWithSession(app, shareToken, session_token);
    expect(getRes.status).toBe(200);
  });

  it('stores token hashes at rest, not raw tokens', async () => {
    const { app, db, syncToken } = createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

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

    const participantRows = db.$client
      .prepare('SELECT session_token_hash FROM participants')
      .all() as Array<{ session_token_hash: string }>;
    expect(participantRows).toHaveLength(1);
    expect(participantRows[0]?.session_token_hash).toBe(hashToken(session_token));
    expect(participantRows[0]?.session_token_hash).not.toBe(session_token);
  });

  it('portal endpoints send CORS headers; sync endpoints do not', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = (await joinRes.json()) as { session_token: string };

    const portalRes = await viewWithSession(app, shareToken, session_token, {
      Origin: 'http://localhost:5174',
    });
    expect(portalRes.headers.get('access-control-allow-origin')).toBe('*');

    const syncRes = await app.request('/api/sync/v1/projects/gid-1/projection', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5174' },
    });
    expect(syncRes.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /join', () => {
  it('returns 400 for empty name', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const res = await joinShare(app, shareToken, '   ');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'name_required' });
  });

  it('returns 401 for unknown share token', async () => {
    const { app } = createTestApp();
    const res = await joinShare(app, generateShareToken(), 'Alex');
    expect(res.status).toBe(401);
  });

  it('returns 401 for revoked share', async () => {
    const { app, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);
    await app.request(`/api/sync/v1/shares/${shareToken}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${syncToken}` },
    });

    const res = await joinShare(app, shareToken, 'Alex');
    expect(res.status).toBe(401);
  });

  it('logs join activity', async () => {
    const { app, db, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    expect(joinRes.status).toBe(200);
    const { participant } = (await joinRes.json()) as { participant: { id: string } };

    const entries = db.select().from(activityLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('join');
    expect(entries[0]?.participantId).toBe(participant.id);
  });
});

describe('activity log', () => {
  it('logs view on GET view', async () => {
    const { app, db, syncToken } = createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token, participant } = (await joinRes.json()) as {
      session_token: string;
      participant: { id: string };
    };

    await viewWithSession(app, shareToken, session_token);

    const entries = db.select().from(activityLog).all();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.action).sort()).toEqual(['join', 'view']);
    const viewEntry = entries.find((e) => e.action === 'view');
    expect(viewEntry?.participantId).toBe(participant.id);
  });
});
