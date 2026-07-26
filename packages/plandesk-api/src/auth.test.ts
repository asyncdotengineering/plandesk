import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import { createTestApp, parseJson } from './test-helpers.js';

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`plandesk:${password}`).toString('base64')}`;
}

describe('createAuthMiddleware (basic)', () => {
  it('returns 401 for REST without credentials when auth is enabled', async () => {
    const { app } = await createTestApp({ authPassword: 'secret' });
    // /auth/session is org-gated (not public); health is public for uptime probes.
    const res = await app.request('/api/v1/auth/session');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="Plan Desk"');
  });

  it('allows REST with correct basic credentials', async () => {
    const { app } = await createTestApp({ authPassword: 'secret' });
    const res = await app.request('/api/v1/auth/session', {
      headers: { Authorization: basicAuth('secret') },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 for wrong password', async () => {
    const { app } = await createTestApp({ authPassword: 'secret' });
    const res = await app.request('/api/v1/auth/session', {
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

  it('skips basic auth for public health path', async () => {
    const { app } = await createTestApp({ authPassword: 'secret' });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('createOrgAuthMiddleware', () => {
  it('rejects a stranger bearer (not a better-auth key) with 401', async () => {
    const { app } = await createTestApp({ bindHost: '0.0.0.0' });
    const res = await app.request('/api/v1/auth/session', {
      headers: { Authorization: 'Bearer plandesk_mcp_not-real' },
    });
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });

  it('allows loopback single-org without a token', async () => {
    const { app } = await createTestApp({ bindHost: '127.0.0.1' });
    const res = await app.request('/api/v1/auth/session');
    expect(res.status).toBe(200);
  });

  it('GET /api/v1/health is public on hosted bind (no auth → 200)', async () => {
    const { app } = await createTestApp({ bindHost: '0.0.0.0' });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
