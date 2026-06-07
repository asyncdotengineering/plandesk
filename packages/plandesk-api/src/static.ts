import { existsSync } from 'node:fs';
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
}
