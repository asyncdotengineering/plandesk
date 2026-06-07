import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

const defaultDistPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/plandesk-web/dist',
);

export function mountStatic(app: Hono, distPath: string = defaultDistPath): void {
  if (!existsSync(distPath)) {
    return;
  }
  app.use('/*', serveStatic({ root: distPath }));

  // SPA fallback: client-side routes (e.g. /projects/:id/flow) have no file on
  // disk, so serve index.html for any non-API GET that didn't match an asset.
  // Without this, a deep-link or reload on a client route falls through to the
  // API's 404. API/MCP paths keep their own not_found handling.
  const indexHtml = join(distPath, 'index.html');
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8');
    app.get('*', (c) => {
      const path = c.req.path;
      if (path.startsWith('/api') || path.startsWith('/mcp')) {
        return c.notFound();
      }
      return c.html(html);
    });
  }
}
