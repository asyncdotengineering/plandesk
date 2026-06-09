import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createParticipantSession,
  hashToken,
  logActivity,
  verifyParticipantSession,
  verifyShareToken,
  verifySyncToken,
} from './auth.js';
import type { SyncDb } from './db/client.js';
import { hostedShares, projectionBlobs } from './db/schema.js';

export type SyncServerDeps = {
  db: SyncDb;
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

export function createSyncServer(deps: SyncServerDeps): Hono {
  const app = new Hono();

  // The portal is a browser app that may reach this server cross-origin (always
  // in dev; in prod whenever the portal bundle and the portal API differ in
  // origin). The capability lives in the URL token, not a cookie, so a wildcard
  // origin is safe here. The /api/sync/* routes are server-to-server — no CORS.
  app.use('/api/portal/*', cors());

  app.put('/api/sync/v1/projects/:gid/projection', async (c) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined || verifySyncToken(deps.db, raw) === undefined) {
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

    const existing = deps.db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, body.share.token_hash))
      .get();

    let shareId: string;
    if (existing !== undefined) {
      shareId = existing.id;
      deps.db
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
      deps.db
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

    const blobExisting = deps.db
      .select({ id: projectionBlobs.id })
      .from(projectionBlobs)
      .where(eq(projectionBlobs.shareId, shareId))
      .get();

    const viewJson = JSON.stringify(body.view);
    if (blobExisting !== undefined) {
      deps.db
        .update(projectionBlobs)
        .set({
          version: body.version,
          viewJson,
          updatedAt: now,
        })
        .where(eq(projectionBlobs.shareId, shareId))
        .run();
    } else {
      deps.db
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

    return c.json({ ok: true });
  });

  app.post('/api/sync/v1/shares/:token/revoke', (c) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined || verifySyncToken(deps.db, raw) === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const shareToken = c.req.param('token');
    const share = deps.db
      .select({ id: hostedShares.id })
      .from(hostedShares)
      .where(eq(hostedShares.tokenHash, hashToken(shareToken)))
      .get();

    if (share === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    deps.db
      .update(hostedShares)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(hostedShares.id, share.id))
      .run();

    return c.json({ ok: true });
  });

  app.get('/api/portal/v1/shares/:token/meta', (c) => {
    const shareToken = c.req.param('token');
    const share = verifyShareToken(deps.db, shareToken);
    if (share === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    return c.json({
      audience_name: share.audienceName,
      mode: share.mode as ShareMode,
    });
  });

  app.post('/api/portal/v1/shares/:token/join', async (c) => {
    const shareToken = c.req.param('token');
    const share = verifyShareToken(deps.db, shareToken);
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

    const { participant, token: sessionToken } = createParticipantSession(deps.db, {
      shareId: share.id,
      name,
      email: body.email,
    });

    logActivity(deps.db, {
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

  app.get('/api/portal/v1/shares/:token/view', (c) => {
    const shareToken = c.req.param('token');
    const sessionRaw = extractBearerToken(c.req.header('Authorization'));
    if (sessionRaw === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const session = verifyParticipantSession(deps.db, sessionRaw);
    if (session === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    if (hashToken(shareToken) !== session.share.tokenHash) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const blob = deps.db
      .select()
      .from(projectionBlobs)
      .where(eq(projectionBlobs.shareId, session.share.id))
      .get();

    if (blob === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    logActivity(deps.db, {
      shareId: session.share.id,
      participantId: session.participant.id,
      action: 'view',
    });

    const view = JSON.parse(blob.viewJson) as Record<string, unknown>;
    const permissions = JSON.parse(session.share.permissions) as Record<string, unknown>;

    return c.json({
      ...view,
      audience_name: session.share.audienceName,
      permissions,
    });
  });

  return app;
}
