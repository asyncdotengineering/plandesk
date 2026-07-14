import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDb, migrate } from '@plandesk/db';
import { createApp } from './server.js';
import { mountStatic } from './static.js';
import { createTestApp } from './test-helpers.js';

describe('createApp', () => {
  it('returns ok from GET /api/v1/health', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 404 for unknown API paths', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/api/v1/unknown');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('mounts the MCP router before the SPA fallback so GET /mcp/ is not shadowed', async () => {
    // A built web SPA must be present for the fallback (app.get('*')) to be active;
    // point the resolver at a throwaway one so this test is deterministic.
    const distDir = mkdtempSync(join(tmpdir(), 'plandesk-spa-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
    const previous = process.env.PLANDESK_WEB_DIST;
    process.env.PLANDESK_WEB_DIST = distDir;
    try {
      const db = await createDb(':memory:');
      await migrate(db);
      const stubMcp = new Hono();
      stubMcp.all('*', (c) => c.json({ mcp: true }));
      const app = createApp({ db, mcp: stubMcp });
      // Node path mounts SPA after createApp (edge uses platform assets instead).
      mountStatic(app, distDir);

      // The MCP transport uses GET /mcp/ for its SSE stream. Before the fix the
      // SPA catch-all shadowed it and returned a 404, breaking reconnect.
      const res = await app.request('/mcp/', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mcp: true });

      // A genuine client route still gets the SPA HTML.
      const spa = await app.request('/projects/whatever');
      expect(spa.headers.get('content-type') ?? '').toContain('text/html');
    } finally {
      if (previous === undefined) {
        delete process.env.PLANDESK_WEB_DIST;
      } else {
        process.env.PLANDESK_WEB_DIST = previous;
      }
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});
