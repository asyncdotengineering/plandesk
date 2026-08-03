import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mountStatic } from './static.js';

describe('mountStatic SPA fallback', () => {
  it('reads index.html per request so deep routes stay fresh after a rebuild', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'plandesk-static-'));
    writeFileSync(join(distDir, 'index.html'), '<script src="/assets/index-OLD.js"></script>');
    const app = new Hono();
    mountStatic(app, distDir);

    const initial = await app.request('/projects/foo/prototypes/bar');
    expect(initial.status).toBe(200);
    expect(await initial.text()).toContain('index-OLD.js');

    writeFileSync(join(distDir, 'index.html'), '<script src="/assets/index-NEW.js"></script>');

    const root = await app.request('/');
    expect(await root.text()).toContain('index-NEW.js');

    const deep = await app.request('/projects/foo/prototypes/bar');
    expect(deep.status).toBe(200);
    const deepBody = await deep.text();
    expect(deepBody).toContain('index-NEW.js');
    expect(deepBody).not.toContain('index-OLD.js');

    rmSync(distDir, { recursive: true, force: true });
  });

  it('returns 404 for missing asset paths instead of the SPA shell', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'plandesk-static-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
    const app = new Hono();
    mountStatic(app, distDir);

    const res = await app.request('/assets/does-not-exist.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');

    rmSync(distDir, { recursive: true, force: true });
  });

  it('still serves the SPA shell for extensionless client routes', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'plandesk-static-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
    const app = new Hono();
    mountStatic(app, distDir);

    const res = await app.request('/projects/whatever');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(await res.text()).toContain('SPA');

    rmSync(distDir, { recursive: true, force: true });
  });

  it('serves the SPA shell for client routes whose final segment contains a dot', async () => {
    const distDir = mkdtempSync(join(tmpdir(), 'plandesk-static-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>SPA</body></html>');
    const app = new Hono();
    mountStatic(app, distDir);

    const res = await app.request('/docs/v1.2');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(await res.text()).toContain('SPA');

    rmSync(distDir, { recursive: true, force: true });
  });
});
