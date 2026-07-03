import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import {
  createParticipantSession,
  hashToken,
  logActivity,
  verifyParticipantSession,
  verifyShareToken,
  verifySyncToken,
} from './auth.js';
import type { SyncDb } from './db/client.js';
import { hostedShares, participants, projectionBlobs, submissions } from './db/schema.js';
import { createShareNotifier, type ShareNotifier } from './notifier.js';

export type SyncServerDeps = {
  db: SyncDb;
  notifier?: ShareNotifier;
};

type ShareMode = 'invite' | 'public';

type ProjectionPushBody = {
  share: {
    token_hash: string;
    audience_name: string;
    mode?: ShareMode;
    invited_emails?: string[];
    permissions: Record<string, unknown>;
    expires_at: string | null;
  };
  version: number;
  view: unknown;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseInvitedEmails(raw: string | null): string[] {
  if (raw === null || raw === '') {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value): value is string => typeof value === 'string').map(normalizeEmail);
}

function isEmailInvited(
  share: { invitedEmails: string | null },
  email: string | undefined,
): boolean {
  if (email === undefined || email.trim() === '') {
    return false;
  }
  const normalized = normalizeEmail(email);
  return parseInvitedEmails(share.invitedEmails).includes(normalized);
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

function parseExpiresAt(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  return new Date(value);
}

type SharePermissions = {
  read?: boolean;
  submit?: boolean;
};

type SubmissionBody = {
  title?: string;
  body?: string;
  severity?: string;
  task_ref?: string;
};

async function verifyParticipantSessionForShare(
  db: SyncDb,
  shareToken: string,
  sessionRaw: string | undefined,
) {
  if (sessionRaw === undefined) {
    return undefined;
  }
  const session = await verifyParticipantSession(db, sessionRaw);
  if (session === undefined) {
    return undefined;
  }
  if (hashToken(shareToken) !== session.share.tokenHash) {
    return undefined;
  }
  return session;
}

function parseSharePermissions(permissionsJson: string): SharePermissions {
  return JSON.parse(permissionsJson) as SharePermissions;
}

export function createSyncServer(deps: SyncServerDeps): Hono {
  const app = new Hono();
  const notifier = deps.notifier ?? createShareNotifier();

  // The portal is a browser app that may reach this server cross-origin (always
  // in dev; in prod whenever the portal bundle and the portal API differ in
  // origin). The capability lives in the URL token, not a cookie, so a wildcard
  // origin is safe here. The /api/sync/* routes are server-to-server — no CORS.
  app.use('/api/portal/*', cors());

  app.put('/api/sync/v1/projects/:gid/projection', async (c) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined || (await verifySyncToken(deps.db, raw)) === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let body: ProjectionPushBody;
    try {
      body = await c.req.json<ProjectionPushBody>();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const gid = c.req.param('gid');
    const now = new Date();
    const expiresAt = parseExpiresAt(body.share.expires_at);
    const permissionsJson = JSON.stringify(body.share.permissions);
    const mode: ShareMode = body.share.mode ?? 'invite';
    const invitedEmailsJson = JSON.stringify((body.share.invited_emails ?? []).map(normalizeEmail));

    const existing = await deps.db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, body.share.token_hash))
      .get();

    let shareId: string;
    if (existing !== undefined) {
      shareId = existing.id;
      await deps.db
        .update(hostedShares)
        .set({
          projectGlobalId: gid,
          audienceName: body.share.audience_name,
          mode,
          invitedEmails: invitedEmailsJson,
          permissions: permissionsJson,
          expiresAt,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(hostedShares.id, shareId))
        .run();
    } else {
      shareId = randomUUID();
      await deps.db
        .insert(hostedShares)
        .values({
          id: shareId,
          projectGlobalId: gid,
          tokenHash: body.share.token_hash,
          audienceName: body.share.audience_name,
          mode,
          invitedEmails: invitedEmailsJson,
          permissions: permissionsJson,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const blobExisting = await deps.db
      .select({ id: projectionBlobs.id })
      .from(projectionBlobs)
      .where(eq(projectionBlobs.shareId, shareId))
      .get();

    const viewJson = JSON.stringify(body.view);
    if (blobExisting !== undefined) {
      await deps.db
        .update(projectionBlobs)
        .set({
          version: body.version,
          viewJson,
          updatedAt: now,
        })
        .where(eq(projectionBlobs.shareId, shareId))
        .run();
    } else {
      await deps.db
        .insert(projectionBlobs)
        .values({
          id: randomUUID(),
          shareId,
          version: body.version,
          viewJson,
          updatedAt: now,
        })
        .run();
    }

    notifier.notify(shareId);

    return c.json({ ok: true });
  });

  app.get('/api/sync/v1/projects/:gid/submissions', async (c) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined || (await verifySyncToken(deps.db, raw)) === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const gid = c.req.param('gid');
    const sinceRaw = c.req.query('since');
    const since = sinceRaw !== undefined && sinceRaw !== '' ? new Date(sinceRaw) : undefined;

    const conditions = [eq(hostedShares.projectGlobalId, gid)];
    if (since !== undefined && !Number.isNaN(since.getTime())) {
      conditions.push(gt(submissions.createdAt, since));
    }

    const rows = await deps.db
      .select({
        id: submissions.id,
        shareId: submissions.shareId,
        participantId: participants.id,
        participantName: participants.name,
        title: submissions.title,
        body: submissions.body,
        severity: submissions.severity,
        taskRef: submissions.taskRef,
        status: submissions.status,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .innerJoin(hostedShares, eq(submissions.shareId, hostedShares.id))
      .innerJoin(participants, eq(submissions.participantId, participants.id))
      .where(and(...conditions))
      .orderBy(asc(submissions.createdAt))
      .all();

    return c.json(
      rows.map((row) => ({
        id: row.id,
        share_id: row.shareId,
        participant: { id: row.participantId, name: row.participantName },
        title: row.title,
        body: row.body,
        severity: row.severity,
        task_ref: row.taskRef,
        status: row.status,
        created_at: row.createdAt.toISOString(),
      })),
    );
  });

  const ackStatuses = ['accepted', 'rejected', 'in_progress', 'done'] as const;
  type AckStatus = (typeof ackStatuses)[number];

  function isAckStatus(value: string | undefined): value is AckStatus {
    return value !== undefined && (ackStatuses as readonly string[]).includes(value);
  }

  app.post('/api/sync/v1/projects/:gid/submissions/:id/ack', async (c) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined || (await verifySyncToken(deps.db, raw)) === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let body: { status?: string };
    try {
      body = await c.req.json<{ status?: string }>();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!isAckStatus(body.status)) {
      return c.json({ error: 'invalid_status' }, 400);
    }

    const gid = c.req.param('gid');
    const submissionId = c.req.param('id');

    const row = await deps.db
      .select({ id: submissions.id })
      .from(submissions)
      .innerJoin(hostedShares, eq(submissions.shareId, hostedShares.id))
      .where(and(eq(submissions.id, submissionId), eq(hostedShares.projectGlobalId, gid)))
      .get();

    if (row === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    await deps.db
      .update(submissions)
      .set({ status: body.status })
      .where(eq(submissions.id, submissionId))
      .run();

    return c.json({ ok: true });
  });

  app.post('/api/sync/v1/shares/:token/revoke', async (c) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined || (await verifySyncToken(deps.db, raw)) === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const shareToken = c.req.param('token');
    const share = await deps.db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, hashToken(shareToken)))
      .get();

    if (share === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    await deps.db
      .update(hostedShares)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(hostedShares.id, share.id))
      .run();

    return c.json({ ok: true });
  });

  app.get('/api/portal/v1/shares/:token/events', async (c) => {
    const shareToken = c.req.param('token');
    const share = await verifyShareToken(deps.db, shareToken);
    if (share === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    return streamSSE(c, async (stream) => {
      let active = true;
      const unsub = notifier.subscribe(share.id, () => {
        void stream.writeSSE({ data: JSON.stringify({ type: 'projection_updated' }) });
      });

      const cleanup = () => {
        if (!active) {
          return;
        }
        active = false;
        clearInterval(keepAlive);
        unsub();
      };

      await stream.write(': connected\n\n');

      const keepAlive = setInterval(() => {
        if (active) {
          void stream.write(': keep-alive\n\n');
        }
      }, 25_000);

      c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
      stream.onAbort(cleanup);

      await new Promise<void>((resolve) => {
        if (c.req.raw.signal.aborted) {
          cleanup();
          resolve();
          return;
        }
        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            cleanup();
            resolve();
          },
          { once: true },
        );
      });
    });
  });

  app.get('/api/portal/v1/shares/:token/meta', async (c) => {
    const shareToken = c.req.param('token');
    const share = await verifyShareToken(deps.db, shareToken);
    if (share === undefined) {
      // The token IS the identifier: an unknown share is a missing resource,
      // not a failed authorization (and 404 is what the deploy guide's
      // sanity check documents).
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json({
      audience_name: share.audienceName,
      mode: share.mode as ShareMode,
    });
  });

  app.post('/api/portal/v1/shares/:token/join', async (c) => {
    const shareToken = c.req.param('token');
    const share = await verifyShareToken(deps.db, shareToken);
    if (share === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let body: { name?: string; email?: string };
    try {
      body = await c.req.json<{ name?: string; email?: string }>();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const name = body.name?.trim() ?? '';
    if (name === '') {
      return c.json({ error: 'name_required' }, 400);
    }

    if (share.mode === 'invite' && !isEmailInvited(share, body.email)) {
      return c.json({ error: 'email_not_invited' }, 403);
    }

    const { participant, token: sessionToken } = await createParticipantSession(deps.db, {
      shareId: share.id,
      name,
      email: body.email,
    });

    await logActivity(deps.db, {
      shareId: share.id,
      participantId: participant.id,
      action: 'join',
    });

    const permissions = JSON.parse(share.permissions) as Record<string, unknown>;

    return c.json({
      session_token: sessionToken,
      participant: { id: participant.id, name: participant.name },
      share: { audience_name: share.audienceName, permissions },
    });
  });

  app.get('/api/portal/v1/shares/:token/view', async (c) => {
    const shareToken = c.req.param('token');
    const sessionRaw = extractBearerToken(c.req.header('Authorization'));
    const session = await verifyParticipantSessionForShare(deps.db, shareToken, sessionRaw);
    if (session === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const blob = await deps.db
      .select()
      .from(projectionBlobs)
      .where(eq(projectionBlobs.shareId, session.share.id))
      .get();

    if (blob === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    await logActivity(deps.db, {
      shareId: session.share.id,
      participantId: session.participant.id,
      action: 'view',
    });

    const view = JSON.parse(blob.viewJson) as Record<string, unknown>;
    const permissions = parseSharePermissions(session.share.permissions);

    return c.json({
      ...view,
      audience_name: session.share.audienceName,
      permissions,
    });
  });

  app.post('/api/portal/v1/shares/:token/submissions', async (c) => {
    const shareToken = c.req.param('token');
    const sessionRaw = extractBearerToken(c.req.header('Authorization'));
    const session = await verifyParticipantSessionForShare(deps.db, shareToken, sessionRaw);
    if (session === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const permissions = parseSharePermissions(session.share.permissions);
    if (permissions.submit !== true) {
      return c.json({ error: 'submit_not_permitted' }, 403);
    }

    let body: SubmissionBody;
    try {
      body = await c.req.json<SubmissionBody>();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const title = body.title?.trim() ?? '';
    if (title === '') {
      return c.json({ error: 'title_required' }, 400);
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentCount =
      (
        await deps.db
          .select({ count: count() })
          .from(submissions)
          .where(
            and(
              eq(submissions.participantId, session.participant.id),
              gt(submissions.createdAt, oneMinuteAgo),
            ),
          )
          .get()
      )?.count ?? 0;

    if (recentCount >= 10) {
      return c.json({ error: 'rate_limited' }, 429);
    }

    const submissionId = randomUUID();
    const now = new Date();
    const bodyText = body.body?.trim() === '' ? null : (body.body?.trim() ?? null);
    const severity = body.severity?.trim() === '' ? null : (body.severity?.trim() ?? null);
    const taskRef = body.task_ref?.trim() === '' ? null : (body.task_ref?.trim() ?? null);

    await deps.db
      .insert(submissions)
      .values({
        id: submissionId,
        shareId: session.share.id,
        participantId: session.participant.id,
        title,
        body: bodyText,
        severity,
        taskRef,
        status: 'pending',
        createdAt: now,
      })
      .run();

    await logActivity(deps.db, {
      shareId: session.share.id,
      participantId: session.participant.id,
      action: 'submit',
      detail: submissionId,
    });

    return c.json(
      {
        submission: {
          id: submissionId,
          title,
          severity,
          status: 'pending',
          created_at: now.toISOString(),
        },
      },
      201,
    );
  });

  app.get('/api/portal/v1/shares/:token/submissions', async (c) => {
    const shareToken = c.req.param('token');
    const sessionRaw = extractBearerToken(c.req.header('Authorization'));
    const session = await verifyParticipantSessionForShare(deps.db, shareToken, sessionRaw);
    if (session === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const rows = await deps.db
      .select({
        id: submissions.id,
        title: submissions.title,
        severity: submissions.severity,
        status: submissions.status,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(eq(submissions.participantId, session.participant.id))
      .orderBy(desc(submissions.createdAt))
      .all();

    return c.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        created_at: row.createdAt.toISOString(),
      })),
    );
  });

  return app;
}
