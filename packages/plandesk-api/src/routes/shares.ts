import { invalidArgument, invalidRequest } from './errors.js';
import { type Context, Hono } from 'hono';
import type { ShareResourceRef, ShareService } from '../services/share.js';

const EXPIRES_MS: Record<'24h' | '7d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// Body `expires` → the Date | null | undefined the share service expects:
// '24h'/'7d' → a future Date, 'never' → null, absent → undefined (service default).
function resolveExpiresAt(expires: unknown): Date | null | undefined {
  if (expires === 'never') return null;
  if (expires === '24h' || expires === '7d') return new Date(Date.now() + EXPIRES_MS[expires]);
  return undefined;
}

export function createSharesRouter(shareService: ShareService): Hono {
  const router = new Hono();

  // Mint a public, read-only Markdown link for one task, document, or prototype
  // (the UI "Share" action; the same links the create_share_link MCP tool produces).
  const createShareHandler = (kind: 'task' | 'document' | 'prototype') => async (c: Context) => {
    const id = c.req.param('id') ?? '';
    const body = (await c.req.json().catch(() => ({}))) as { expires?: unknown; submit?: unknown };
    if (
      body.expires !== undefined &&
      body.expires !== '24h' &&
      body.expires !== '7d' &&
      body.expires !== 'never'
    ) {
      return c.json({ error: 'invalid_expires' }, 400);
    }
    if (body.submit !== undefined && typeof body.submit !== 'boolean') {
      return invalidArgument(c, 'submit', 'submit must be a boolean');
    }
    const origin = new URL(c.req.url).origin;
    const resource: ShareResourceRef =
      kind === 'prototype' ? { kind: 'prototype', ids: [id] } : { kind, id };
    const result = await shareService.createResourceShare(
      {
        resource,
        expiresAt: resolveExpiresAt(body.expires),
        permissions: { read: true, submit: body.submit === true },
      },
      origin,
    );
    if (!result) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(
      { url: result.url, markdown_url: result.markdownUrl, expires_at: result.expiresAt },
      201,
    );
  };

  router.post('/tasks/:id/share', createShareHandler('task'));
  router.post('/documents/:id/share', createShareHandler('document'));
  router.post('/prototypes/:id/share', createShareHandler('prototype'));

  // Share an entire workspace (all its projects) with a client. Owner-gated in
  // the service via getTeamInOrg (workspace must be in the caller's org).
  router.post('/workspaces/:workspaceId/share', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    let body: {
      audience_name?: string;
      mode?: 'invite' | 'public';
      submit?: boolean;
      invited_emails?: string[];
      expires?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const audienceName = (body.audience_name ?? '').trim();
    if (audienceName === '') {
      return invalidArgument(
        c,
        'audience_name',
        'audience_name is required and must be a non-empty string',
      );
    }
    const mode = body.mode === 'public' ? 'public' : 'invite';
    const origin = new URL(c.req.url).origin;
    const result = await shareService.createWorkspaceShare(
      workspaceId,
      {
        audienceName,
        mode,
        permissions: { read: true, submit: body.submit === true },
        ...(body.invited_emails !== undefined ? { invitedEmails: body.invited_emails } : {}),
      },
      origin,
    );
    if (result === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ url: result.url, token: result.token }, 201);
  });

  // Hono doesn't match a literal `.md` suffix inside a param, so the route
  // takes the raw segment and the handler enforces + strips the extension.
  router.get('/share/:tokenWithExt', async (c) => {
    const raw = c.req.param('tokenWithExt');
    if (!raw.endsWith('.md')) {
      return c.notFound();
    }
    const token = raw.slice(0, -'.md'.length);
    const origin = new URL(c.req.url).origin;

    const result = await shareService.getResourceMarkdown(token, origin);
    if (result.status === 'not_found') {
      return c.json({ error: 'not_found' }, 404);
    }
    if (result.status === 'gone') {
      return c.json({ error: 'gone' }, 410);
    }

    return c.body(result.markdown, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  });

  // Pre-join: audience name + mode so the portal can render the join gate.
  router.get('/share/:token/meta', async (c) => {
    const token = c.req.param('token');
    const result = await shareService.getShareMeta(token);
    if (result.status === 'not_found') {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ audience_name: result.audienceName, mode: result.mode });
  });

  // Named join: gate by invite allow-list when mode=invite; mint guest session.
  router.post('/share/:token/join', async (c) => {
    const token = c.req.param('token');
    let body: { name?: string; email?: string };
    try {
      body = await c.req.json<{ name?: string; email?: string }>();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const result = await shareService.joinShare(token, {
      name: body.name ?? '',
      email: body.email,
    });

    if (result.status === 'unauthorized') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (result.status === 'name_required') {
      return c.json({ error: 'name_required' }, 400);
    }
    if (result.status === 'email_not_invited') {
      return c.json({ error: 'email_not_invited' }, 403);
    }

    return c.json({
      session_token: result.sessionToken,
      participant: result.participant,
      share: {
        audience_name: result.share.audienceName,
        permissions: result.share.permissions,
      },
    });
  });

  // Guest-session-gated portal view (middleware sets AuthContext kind guest).
  // Live projection per request; uniform 404 on any failure shape.
  router.get('/share/:token/view', async (c) => {
    const token = c.req.param('token');
    const view = await shareService.getClientView(token);
    if (view === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(view);
  });

  // Guest moderated inbox — same guest session as view (BA6b single-server).
  router.post('/share/:token/submissions', async (c) => {
    const token = c.req.param('token');
    let body: {
      title?: string;
      body?: string;
      severity?: string;
      task_ref?: string;
      project_id?: string;
    };
    try {
      body = await c.req.json<{
        title?: string;
        body?: string;
        severity?: string;
        task_ref?: string;
        project_id?: string;
      }>();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const result = await shareService.submitIssue(token, {
      title: body.title ?? '',
      body: body.body,
      severity: body.severity,
      task_ref: body.task_ref,
      project_id: body.project_id,
    });

    if (result.status === 'unauthorized') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (result.status === 'submit_not_permitted') {
      return c.json({ error: 'submit_not_permitted' }, 403);
    }
    if (result.status === 'title_required') {
      return c.json({ error: 'title_required' }, 400);
    }
    if (result.status === 'project_required') {
      return c.json({ error: 'project_required' }, 400);
    }
    if (result.status === 'rate_limited') {
      return c.json({ error: 'rate_limited' }, 429);
    }

    return c.json({ submission: result.submission }, 201);
  });

  router.get('/share/:token/submissions', async (c) => {
    const token = c.req.param('token');
    const result = await shareService.listMySubmissions(token);
    if (result.status === 'unauthorized') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return c.json(result.submissions);
  });

  router.post('/share/:token/artifact-comments', async (c) => {
    const token = c.req.param('token');
    let body: {
      artifact_id?: string;
      body?: string;
      passage?: string | null;
      anchor?: string | null;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (typeof body.artifact_id !== 'string' || typeof body.body !== 'string') {
      return invalidRequest(c, 'artifact_id and body are both required and must be strings');
    }

    const result = await shareService.createGuestArtifactComment(token, {
      artifactId: body.artifact_id,
      body: body.body,
      passage: body.passage,
      anchor: body.anchor,
    });
    if (result.status === 'unauthorized') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (result.status === 'not_found') {
      return c.json({ error: 'not_found' }, 404);
    }
    if (result.status === 'submit_not_permitted') {
      return c.json({ error: 'submit_not_permitted' }, 403);
    }
    if (result.status === 'invalid_argument') {
      return invalidRequest(c, 'artifact_id and body must be valid for this share');
    }
    return c.json(result.comment, 201);
  });

  router.get('/share/:token/artifact-comments', async (c) => {
    const artifactId = c.req.query('artifact_id');
    if (artifactId === undefined) {
      return invalidArgument(c, 'artifact_id', 'artifact_id query parameter is required');
    }
    const result = await shareService.listGuestArtifactComments(c.req.param('token'), artifactId);
    if (result.status === 'unauthorized') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (result.status === 'not_found') {
      return c.json({ error: 'not_found' }, 404);
    }
    if (result.status === 'invalid_argument') {
      return invalidArgument(c, 'artifact_id', 'artifact_id must be valid for this share');
    }
    return c.json(result.comments);
  });

  return router;
}
