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

  // Mint a public, read-only Markdown link for one task or document (the UI
  // "Share" action; the same links the create_share_link MCP tool produces).
  const createShareHandler = (kind: ShareResourceRef['kind']) => async (c: Context) => {
    const id = c.req.param('id') ?? '';
    const body = (await c.req.json().catch(() => ({}))) as { expires?: unknown };
    if (
      body.expires !== undefined &&
      body.expires !== '24h' &&
      body.expires !== '7d' &&
      body.expires !== 'never'
    ) {
      return c.json({ error: 'invalid_expires' }, 400);
    }
    const origin = new URL(c.req.url).origin;
    const result = await shareService.createResourceShare(
      { resource: { kind, id }, expiresAt: resolveExpiresAt(body.expires) },
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

  return router;
}
