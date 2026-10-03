import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

// Resolve the built web SPA across install layouts:
//   1. PLANDESK_WEB_DIST env override
//   2. monorepo dev path (apps/plandesk-web/dist) — prefer over bundled web/
//      so a stale packages/plandesk-api/web from an old prepack cannot shadow
//      a freshly built SPA during local serve / browser harness runs
//   3. bundled `web/` next to this package (published npm package ships it here)
// First candidate that contains index.html wins; otherwise the last candidate.
function resolveDefaultDistPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../@plandesk/api/dist
  const candidates = [
    process.env.PLANDESK_WEB_DIST,
    join(here, '../../../apps/plandesk-web/dist'), // monorepo dev
    join(here, '../web'), // bundled in the published package
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return (
    candidates.find((p) => existsSync(join(p, 'index.html'))) ??
    candidates[candidates.length - 1] ??
    join(here, '../../../apps/plandesk-web/dist')
  );
}

// Extension allow-list (not "any dot"): client routes may carry dots in slugs
// (e.g. /docs/v1.2) without being build-emitted assets. Only known Vite output
// extensions get a 404 when missing; everything else falls through to the shell.
const ASSET_EXTENSIONS = new Set([
  'css',
  'ico',
  'jpg',
  'js',
  'json',
  'map',
  'mjs',
  'png',
  'svg',
  'ttf',
  'webp',
  'woff',
  'woff2',
]);

function looksLikeAsset(path: string): boolean {
  const lastSegment = path.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) {
    return false;
  }
  const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
  return ASSET_EXTENSIONS.has(ext);
}

export function mountStatic(app: Hono, distPath: string = resolveDefaultDistPath()): void {
  if (!existsSync(distPath)) {
    return;
  }
  app.use('/*', serveStatic({ root: distPath }));

  // SPA fallback: client-side routes (e.g. /projects/:id/flow) have no file on
  // disk, so serve index.html for any non-API GET that didn't match an asset.
  // Without this, a deep-link or reload on a client route falls through to the
  // API's 404. API/MCP paths keep their own not_found handling.
  //
  // Middleware, not a `GET *` route: the 405 handler derives `Allow` from the
  // registered routes, and a catch-all GET route would make every unknown API
  // path look like it supports GET.
  const indexHtml = join(distPath, 'index.html');
  if (existsSync(indexHtml)) {
    app.use('*', async (c, next) => {
      const path = c.req.path;
      if (
        (c.req.method !== 'GET' && c.req.method !== 'HEAD') ||
        path.startsWith('/api') ||
        path.startsWith('/mcp') ||
        looksLikeAsset(path)
      ) {
        await next();
        return;
      }
      return c.html(readFileSync(indexHtml, 'utf8'));
    });
  }
}
