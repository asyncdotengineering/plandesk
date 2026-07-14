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

  return router;
}
