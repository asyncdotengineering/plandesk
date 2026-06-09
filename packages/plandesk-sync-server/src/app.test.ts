import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSyncToken, hashToken, seedSyncToken, verifySyncToken } from './auth.js';
import { createSyncServer } from './app.js';
import { createSyncDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { activityLog, hostedShares, projectionBlobs, submissions } from './db/schema.js';

describe('seedSyncToken (self-host bootstrap)', () => {
  it('seeds an owner token once and authenticates it; second call is a no-op', async () => {
    const db = createSyncDb(':memory:');
    await migrate(db);
    const raw = 'plandesk_sync_bootstrap-example';

    expect(await seedSyncToken(db, raw)).toBe(true);
    expect(await verifySyncToken(db, raw)).toBeDefined();
    expect(await seedSyncToken(db, raw)).toBe(false); // idempotent
  });
});

function generateShareToken(): string {
  return `plandesk_share_${randomBytes(32).toString('base64url')}`;
}

async function createTestApp() {
  const db = createSyncDb(':memory:');
  await migrate(db);
  const { token: syncToken } = await createSyncToken(db, { label: 'test' });
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

type SharePushOptions = {
  mode?: 'invite' | 'public';
  invited_emails?: string[];
  audience_name?: string;
  expires_at?: string | null;
  permissions?: { read: boolean; submit: boolean };
};

async function pushProjection(
  app: ReturnType<typeof createSyncServer>,
  syncToken: string,
  gid: string,
  shareToken: string,
  view: unknown = sampleView,
  version = 1,
  shareOptions: SharePushOptions = { mode: 'public' },
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
        audience_name: shareOptions.audience_name ?? 'Acme Corp',
        mode: shareOptions.mode ?? 'public',
        invited_emails: shareOptions.invited_emails,
        permissions: shareOptions.permissions ?? { read: true, submit: false },
        expires_at: shareOptions.expires_at ?? null,
      },
      version,
      view,
    }),
  });
}

async function fetchShareMeta(app: ReturnType<typeof createSyncServer>, shareToken: string) {
  return app.request(`/api/portal/v1/shares/${shareToken}/meta`);
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

async function submitIssue(
  app: ReturnType<typeof createSyncServer>,
  shareToken: string,
  sessionToken: string,
  body: { title: string; body?: string; severity?: string; task_ref?: string },
) {
  return app.request(`/api/portal/v1/shares/${shareToken}/submissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function listSubmissions(
  app: ReturnType<typeof createSyncServer>,
  shareToken: string,
  sessionToken: string,
) {
  return app.request(`/api/portal/v1/shares/${shareToken}/submissions`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

async function setupSubmitShare(app: ReturnType<typeof createSyncServer>, syncToken: string) {
  const shareToken = generateShareToken();
  await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
    mode: 'public',
    permissions: { read: true, submit: true },
  });
  const joinRes = await joinShare(app, shareToken, 'Alex');
  const { session_token } = await joinRes.json<{ session_token: string }>();
  return { shareToken, session_token };
}

describe('createSyncServer', () => {
  it('PUT projection returns 401 without Authorization', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/sync/v1/projects/gid-1/projection', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share: {}, version: 1, view: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT projection returns 401 for invalid sync token', async () => {
    const { app } = await createTestApp();
    const res = await pushProjection(app, 'plandesk_sync_invalid', 'gid-1', generateShareToken());
    expect(res.status).toBe(401);
  });

  it('PUT projection stores share and blob; join + GET view returns projection', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();

    const putRes = await pushProjection(app, syncToken, 'gid-1', shareToken);
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ ok: true });

    const joinRes = await joinShare(app, shareToken, 'Alex');
    expect(joinRes.status).toBe(200);
    const joinPayload = await joinRes.json<{
      session_token: string;
      participant: { id: string; name: string };
      share: { audience_name: string; permissions: Record<string, unknown> };
    }>();
    expect(joinPayload.participant.name).toBe('Alex');
    expect(joinPayload.share.audience_name).toBe('Acme Corp');
    expect(joinPayload.share.permissions).toEqual({ read: true, submit: false });

    const getRes = await viewWithSession(app, shareToken, joinPayload.session_token);
    expect(getRes.status).toBe(200);
    const payload = await getRes.json<Record<string, unknown>>();
    expect(payload['project']).toEqual(sampleView.project);
    expect(payload['audience_name']).toBe('Acme Corp');
    expect(payload['permissions']).toEqual({ read: true, submit: false });
  });

  it('GET view returns 401 without participant session', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const getRes = await app.request(`/api/portal/v1/shares/${shareToken}/view`);
    expect(getRes.status).toBe(401);
  });

  it('GET view returns 401 for invalid participant session', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const getRes = await viewWithSession(app, shareToken, 'plandesk_pt_invalid');
    expect(getRes.status).toBe(401);
  });

  it('GET view returns 401 when session belongs to a different share', async () => {
    const { app, syncToken } = await createTestApp();
    const shareTokenA = generateShareToken();
    const shareTokenB = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareTokenA);
    await pushProjection(app, syncToken, 'gid-2', shareTokenB);

    const joinRes = await joinShare(app, shareTokenA, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const getRes = await viewWithSession(app, shareTokenB, session_token);
    expect(getRes.status).toBe(401);
  });

  it('GET view returns 404 when share exists but no projection blob', async () => {
    const { app, db, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    const tokenHash = hashToken(shareToken);

    const putRes = await pushProjection(app, syncToken, 'gid-1', shareToken);
    expect(putRes.status).toBe(200);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const share = await db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, tokenHash))
      .get();
    expect(share).toBeDefined();
    if (share === undefined) {
      throw new Error('expected share row');
    }

    await db.delete(projectionBlobs).where(eq(projectionBlobs.shareId, share.id)).run();

    const getRes = await viewWithSession(app, shareToken, session_token);
    expect(getRes.status).toBe(404);
  });

  it('GET view returns 401 for unknown share token', async () => {
    const { app } = await createTestApp();
    const res = await viewWithSession(app, generateShareToken(), 'plandesk_pt_invalid');
    expect(res.status).toBe(401);
  });

  it('GET view returns 401 for expired share', async () => {
    const { app, syncToken } = await createTestApp();
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
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const revokeRes = await app.request(`/api/sync/v1/shares/${shareToken}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${syncToken}` },
    });
    expect(revokeRes.status).toBe(200);

    const getRes = await viewWithSession(app, shareToken, session_token);
    expect(getRes.status).toBe(401);
  });

  it('POST revoke returns 401 without sync token', async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/api/sync/v1/shares/${generateShareToken()}/revoke`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('PUT projection upserts share and updates version', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1);
    const updatedView = { ...sampleView, progress: { todo: 0, in_progress: 1, done: 0 } };
    await pushProjection(app, syncToken, 'gid-1', shareToken, updatedView, 2);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const getRes = await viewWithSession(app, shareToken, session_token);
    expect(getRes.status).toBe(200);
    const payload = await getRes.json<{ progress: { in_progress: number } }>();
    expect(payload.progress.in_progress).toBe(1);
  });

  it('revoked share can be reactivated by push clearing revoked_at', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

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
    const { app, db, syncToken } = await createTestApp();
    const shareToken = generateShareToken();

    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const rows = await db.all<{ token_hash: string }>(sql`SELECT token_hash FROM hosted_shares`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashToken(shareToken));
    expect(rows[0]?.token_hash).not.toBe(shareToken);

    const syncRows = await db.all<{ token_hash: string }>(sql`SELECT token_hash FROM sync_tokens`);
    expect(syncRows[0]?.token_hash).toBe(hashToken(syncToken));
    expect(syncRows[0]?.token_hash).not.toBe(syncToken);

    const participantRows = await db.all<{ session_token_hash: string }>(
      sql`SELECT session_token_hash FROM participants`,
    );
    expect(participantRows).toHaveLength(1);
    expect(participantRows[0]?.session_token_hash).toBe(hashToken(session_token));
    expect(participantRows[0]?.session_token_hash).not.toBe(session_token);
  });

  it('portal endpoints send CORS headers; sync endpoints do not', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

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
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const res = await joinShare(app, shareToken, '   ');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'name_required' });
  });

  it('returns 401 for unknown share token', async () => {
    const { app } = await createTestApp();
    const res = await joinShare(app, generateShareToken(), 'Alex');
    expect(res.status).toBe(401);
  });

  it('returns 401 for revoked share', async () => {
    const { app, syncToken } = await createTestApp();
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
    const { app, db, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    expect(joinRes.status).toBe(200);
    const { participant } = await joinRes.json<{ participant: { id: string } }>();

    const entries = await db.select().from(activityLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('join');
    expect(entries[0]?.participantId).toBe(participant.id);
  });

  it('invite mode rejects join without email (403)', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
      mode: 'invite',
      invited_emails: ['alex@acme.com'],
    });

    const res = await joinShare(app, shareToken, 'Alex');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'email_not_invited' });
  });

  it('invite mode rejects non-invited email (403)', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
      mode: 'invite',
      invited_emails: ['alex@acme.com'],
    });

    const res = await joinShare(app, shareToken, 'Alex', 'other@acme.com');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'email_not_invited' });
  });

  it('invite mode accepts invited email (case-insensitive)', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
      mode: 'invite',
      invited_emails: ['Alex@Acme.com'],
    });

    const res = await joinShare(app, shareToken, 'Alex', '  alex@acme.com  ');
    expect(res.status).toBe(200);
  });

  it('public mode allows join without email', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
      mode: 'public',
    });

    const res = await joinShare(app, shareToken, 'Alex');
    expect(res.status).toBe(200);
  });

  it('defaults to invite mode with empty invited list when mode omitted on push', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();

    const putRes = await app.request('/api/sync/v1/projects/gid-1/projection', {
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
        version: 1,
        view: sampleView,
      }),
    });
    expect(putRes.status).toBe(200);

    const metaRes = await fetchShareMeta(app, shareToken);
    expect(metaRes.status).toBe(200);
    expect(await metaRes.json()).toEqual({ audience_name: 'Acme Corp', mode: 'invite' });

    const joinRes = await joinShare(app, shareToken, 'Alex', 'anyone@acme.com');
    expect(joinRes.status).toBe(403);
  });
});

describe('GET /meta', () => {
  it('returns audience_name and mode for valid token', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
      mode: 'invite',
      invited_emails: ['alex@acme.com'],
    });

    const res = await fetchShareMeta(app, shareToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ audience_name: 'Acme Corp', mode: 'invite' });
  });

  it('returns 401 for invalid token', async () => {
    const { app } = await createTestApp();
    const res = await fetchShareMeta(app, generateShareToken());
    expect(res.status).toBe(401);
  });
});

describe('POST /submissions', () => {
  it('creates a pending submission with submit permission', async () => {
    const { app, db, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    const res = await submitIssue(app, shareToken, session_token, {
      title: 'Broken button',
      body: 'Click does nothing',
      severity: 'high',
      task_ref: 't1',
    });
    expect(res.status).toBe(201);
    const payload = await res.json<{
      submission: {
        id: string;
        title: string;
        severity: string;
        status: string;
        created_at: string;
      };
    }>();
    expect(payload.submission.title).toBe('Broken button');
    expect(payload.submission.severity).toBe('high');
    expect(payload.submission.status).toBe('pending');
    expect(payload.submission.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const row = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, payload.submission.id))
      .get();
    expect(row?.status).toBe('pending');
    expect(row?.body).toBe('Click does nothing');
    expect(row?.taskRef).toBe('t1');
  });

  it('returns 400 for empty title', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    const res = await submitIssue(app, shareToken, session_token, { title: '   ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'title_required' });
  });

  it('returns 401 without participant session', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken } = await setupSubmitShare(app, syncToken);

    const res = await submitIssue(app, shareToken, '', { title: 'Bug' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when session belongs to a different share', async () => {
    const { app, syncToken } = await createTestApp();
    const shareTokenA = generateShareToken();
    const shareTokenB = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareTokenA, sampleView, 1, {
      permissions: { read: true, submit: true },
    });
    await pushProjection(app, syncToken, 'gid-2', shareTokenB, sampleView, 1, {
      permissions: { read: true, submit: true },
    });

    const joinRes = await joinShare(app, shareTokenA, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const res = await submitIssue(app, shareTokenB, session_token, { title: 'Bug' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when share lacks submit permission', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);
    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token } = await joinRes.json<{ session_token: string }>();

    const res = await submitIssue(app, shareToken, session_token, { title: 'Bug' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'submit_not_permitted' });
  });

  it('returns 429 when rate limit exceeded', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    for (let i = 0; i < 10; i += 1) {
      const res = await submitIssue(app, shareToken, session_token, {
        title: `Issue ${String(i)}`,
      });
      expect(res.status).toBe(201);
    }

    const limited = await submitIssue(app, shareToken, session_token, { title: 'One too many' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
  });

  it('logs submit activity', async () => {
    const { app, db, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    const res = await submitIssue(app, shareToken, session_token, { title: 'Bug' });
    const { submission } = await res.json<{ submission: { id: string } }>();

    const submitEntry = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'submit'))
      .get();
    expect(submitEntry?.detail).toBe(submission.id);
  });
});

async function ownerPullSubmissions(
  app: ReturnType<typeof createSyncServer>,
  syncToken: string,
  gid: string,
  since?: string,
) {
  const url =
    since !== undefined
      ? `/api/sync/v1/projects/${gid}/submissions?since=${encodeURIComponent(since)}`
      : `/api/sync/v1/projects/${gid}/submissions`;
  return app.request(url, {
    headers: { Authorization: `Bearer ${syncToken}` },
  });
}

describe('GET /api/sync/v1/projects/:gid/submissions', () => {
  it('returns all project submissions with participant names', async () => {
    const { app, syncToken } = await createTestApp();
    const shareTokenA = generateShareToken();
    const shareTokenB = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareTokenA, sampleView, 1, {
      permissions: { read: true, submit: true },
    });
    await pushProjection(app, syncToken, 'gid-1', shareTokenB, sampleView, 1, {
      permissions: { read: true, submit: true },
    });

    const joinA = await joinShare(app, shareTokenA, 'Alex');
    const { session_token: sessionA } = await joinA.json<{ session_token: string }>();
    const joinB = await joinShare(app, shareTokenB, 'Blake');
    const { session_token: sessionB } = await joinB.json<{ session_token: string }>();

    await submitIssue(app, shareTokenA, sessionA, { title: 'Alex issue' });
    await submitIssue(app, shareTokenB, sessionB, { title: 'Blake issue' });

    const res = await ownerPullSubmissions(app, syncToken, 'gid-1');
    expect(res.status).toBe(200);
    const rows = await res.json<
      Array<{
        title: string;
        participant: { name: string };
        share_id: string;
      }>
    >();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.title).sort()).toEqual(['Alex issue', 'Blake issue']);
    expect(rows.map((row) => row.participant.name).sort()).toEqual(['Alex', 'Blake']);
    expect(rows.every((row) => typeof row.share_id === 'string')).toBe(true);
  });

  it('respects since filter', async () => {
    const { app, db, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    const firstRes = await submitIssue(app, shareToken, session_token, { title: 'First' });
    const { submission: first } = await firstRes.json<{
      submission: { id: string; created_at: string };
    }>();

    const firstRow = await db.select().from(submissions).where(eq(submissions.id, first.id)).get();
    expect(firstRow).toBeDefined();
    if (firstRow === undefined) {
      throw new Error('expected first submission');
    }

    const secondRes = await submitIssue(app, shareToken, session_token, { title: 'Second' });
    const { submission: second } = await secondRes.json<{ submission: { id: string } }>();
    const laterCreatedAt = new Date(firstRow.createdAt.getTime() + 1);
    await db
      .update(submissions)
      .set({ createdAt: laterCreatedAt })
      .where(eq(submissions.id, second.id))
      .run();

    const res = await ownerPullSubmissions(
      app,
      syncToken,
      'gid-1',
      firstRow.createdAt.toISOString(),
    );
    expect(res.status).toBe(200);
    const rows = await res.json<Array<{ title: string }>>();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Second');
  });

  it('returns 401 without sync token', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/sync/v1/projects/gid-1/submissions');
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid sync token', async () => {
    const { app } = await createTestApp();
    const res = await ownerPullSubmissions(app, 'plandesk_sync_invalid', 'gid-1');
    expect(res.status).toBe(401);
  });
});

async function ackSubmission(
  app: ReturnType<typeof createSyncServer>,
  syncToken: string,
  gid: string,
  submissionId: string,
  status: string,
) {
  return app.request(`/api/sync/v1/projects/${gid}/submissions/${submissionId}/ack`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
}

describe('POST /api/sync/v1/projects/:gid/submissions/:id/ack', () => {
  it('updates submission status and participant own-view reflects it', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    const submitRes = await submitIssue(app, shareToken, session_token, { title: 'Ack me' });
    const { submission } = await submitRes.json<{ submission: { id: string } }>();

    const ackRes = await ackSubmission(app, syncToken, 'gid-1', submission.id, 'accepted');
    expect(ackRes.status).toBe(200);
    expect(await ackRes.json()).toEqual({ ok: true });

    const listRes = await listSubmissions(app, shareToken, session_token);
    const rows = await listRes.json<Array<{ id: string; status: string }>>();
    expect(rows.find((row) => row.id === submission.id)?.status).toBe('accepted');
  });

  it('returns 401 without sync token', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/sync/v1/projects/gid-1/submissions/sub-1/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid status', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);
    const submitRes = await submitIssue(app, shareToken, session_token, { title: 'Bad ack' });
    const { submission } = await submitRes.json<{ submission: { id: string } }>();

    const res = await ackSubmission(app, syncToken, 'gid-1', submission.id, 'bogus');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown submission in project', async () => {
    const { app, syncToken } = await createTestApp();
    const res = await ackSubmission(app, syncToken, 'gid-1', 'missing-submission', 'accepted');
    expect(res.status).toBe(404);
  });

  it('returns 404 when submission belongs to a different project', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);
    const submitRes = await submitIssue(app, shareToken, session_token, { title: 'Wrong gid' });
    const { submission } = await submitRes.json<{ submission: { id: string } }>();

    const res = await ackSubmission(app, syncToken, 'gid-other', submission.id, 'accepted');
    expect(res.status).toBe(404);
  });
});

describe('GET /submissions', () => {
  it('returns only the calling participant submissions', async () => {
    const { app, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken, sampleView, 1, {
      permissions: { read: true, submit: true },
    });

    const joinAlex = await joinShare(app, shareToken, 'Alex');
    const { session_token: alexSession } = await joinAlex.json<{ session_token: string }>();
    const joinBlake = await joinShare(app, shareToken, 'Blake');
    const { session_token: blakeSession } = await joinBlake.json<{ session_token: string }>();

    await submitIssue(app, shareToken, alexSession, { title: 'Alex issue' });
    await submitIssue(app, shareToken, blakeSession, { title: 'Blake issue' });

    const alexList = await listSubmissions(app, shareToken, alexSession).then((r) =>
      r.json<Array<{ title: string }>>(),
    );
    expect(alexList).toHaveLength(1);
    expect(alexList[0]?.title).toBe('Alex issue');

    const blakeList = await listSubmissions(app, shareToken, blakeSession).then((r) =>
      r.json<Array<{ title: string }>>(),
    );
    expect(blakeList).toHaveLength(1);
    expect(blakeList[0]?.title).toBe('Blake issue');
  });

  it('returns 401 without participant session', async () => {
    const { app, syncToken } = await createTestApp();
    const { shareToken } = await setupSubmitShare(app, syncToken);

    const res = await app.request(`/api/portal/v1/shares/${shareToken}/submissions`);
    expect(res.status).toBe(401);
  });
});

describe('submission_not_task', () => {
  it('submitting an issue leaves the projection blob unchanged', async () => {
    const { app, db, syncToken } = await createTestApp();
    const { shareToken, session_token } = await setupSubmitShare(app, syncToken);

    const share = await db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, hashToken(shareToken)))
      .get();
    expect(share).toBeDefined();
    if (share === undefined) {
      throw new Error('expected share row');
    }

    const before = await db
      .select()
      .from(projectionBlobs)
      .where(eq(projectionBlobs.shareId, share.id))
      .get();
    expect(before).toBeDefined();
    if (before === undefined) {
      throw new Error('expected projection blob');
    }

    const res = await submitIssue(app, shareToken, session_token, {
      title: 'Should not mutate plan',
      body: 'proposal only',
    });
    expect(res.status).toBe(201);

    const after = await db
      .select()
      .from(projectionBlobs)
      .where(eq(projectionBlobs.shareId, share.id))
      .get();
    expect(after).toBeDefined();
    if (after === undefined) {
      throw new Error('expected projection blob after submit');
    }

    expect(after.viewJson).toBe(before.viewJson);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe('activity log', () => {
  it('logs view on GET view', async () => {
    const { app, db, syncToken } = await createTestApp();
    const shareToken = generateShareToken();
    await pushProjection(app, syncToken, 'gid-1', shareToken);

    const joinRes = await joinShare(app, shareToken, 'Alex');
    const { session_token, participant } = await joinRes.json<{
      session_token: string;
      participant: { id: string };
    }>();

    await viewWithSession(app, shareToken, session_token);

    const entries = await db.select().from(activityLog).all();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.action).sort()).toEqual(['join', 'view']);
    const viewEntry = entries.find((e) => e.action === 'view');
    expect(viewEntry?.participantId).toBe(participant.id);
  });
});
