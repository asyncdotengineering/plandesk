import { Hono } from 'hono';
import type { ShareService } from '../services/share.js';

export function createSharesRouter(shareService: ShareService): Hono {
  const router = new Hono();

  // Hono doesn't match a literal `.md` suffix inside a param, so the route
  // takes the raw segment and the handler enforces + strips the extension.
  router.get('/share/:tokenWithExt', (c) => {
    const raw = c.req.param('tokenWithExt');
    if (!raw.endsWith('.md')) {
      return c.notFound();
    }
    const token = raw.slice(0, -'.md'.length);
    const origin = new URL(c.req.url).origin;

    const result = shareService.getResourceMarkdown(token, origin);
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
