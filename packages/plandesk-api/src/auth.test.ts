import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import { createTestApp } from './test-helpers.js';

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`plandesk:${password}`).toString('base64')}`;
}

describe('createAuthMiddleware', () => {
  it('returns 401 for REST without credentials when auth is enabled', async () => {
    const { app } = createTestApp({ authPassword: 'secret' });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="Plan Desk"');
  });

  it('allows REST with correct basic credentials', async () => {
    const { app } = createTestApp({ authPassword: 'secret' });
    const res = await app.request('/api/v1/health', {
      headers: { Authorization: basicAuth('secret') },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 401 for wrong password', async () => {
    const { app } = createTestApp({ authPassword: 'secret' });
    const res = await app.request('/api/v1/health', {
      headers: { Authorization: basicAuth('wrong') },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('skips basic auth for MCP paths', async () => {
    const app = new Hono();
    app.use('*', createAuthMiddleware('secret'));
    app.get('/mcp/*', (c) => c.text('mcp'));
    const res = await app.request('/mcp/tools');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('mcp');
  });
});
