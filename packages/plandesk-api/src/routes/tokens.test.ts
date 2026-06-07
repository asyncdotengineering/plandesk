import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createDb, migrate, verifyToken } from '@plandesk/db';
import { createApp, createEventBus, createServices } from '../index.js';
import { createTestApp, parseJson } from '../test-helpers.js';

type CreateTokenResponse = {
  id: string;
  name: string;
  token: string;
};

type TokenListItem = {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
};

function createMcpAuthProbe(db: ReturnType<typeof createDb>): Hono {
  const mcp = new Hono();
  mcp.use('*', async (c, next) => {
    const header = c.req.header('Authorization');
    const match = header === undefined ? null : /^Bearer\s+(.+)$/i.exec(header);
    const raw = match?.[1]?.trim();
    if (raw === undefined || verifyToken(db, raw) === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
  mcp.all('*', (c) => c.json({ ok: true }));
  return mcp;
}

function createTestAppWithMcp() {
  const db = createDb(':memory:');
  migrate(db);
  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const app = createApp({ db, eventBus, services, mcp: createMcpAuthProbe(db) });
  return { app, db };
}

describe('mcp-tokens routes', () => {
  it('POST /api/v1/mcp-tokens creates token with raw shown once', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/mcp-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Claude' }),
    });

    expect(res.status).toBe(201);
    const body = await parseJson<CreateTokenResponse>(res);
    expect(body.name).toBe('Claude');
    expect(body.token).toMatch(/^plandesk_mcp_/);
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('POST /api/v1/mcp-tokens rejects missing name', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/mcp-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });

    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_argument' });
  });

  it('GET /api/v1/mcp-tokens lists tokens without secrets', async () => {
    const { app } = createTestApp();
    const createRes = await app.request('/api/v1/mcp-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Listed' }),
    });
    const created = await parseJson<CreateTokenResponse>(createRes);

    const res = await app.request('/api/v1/mcp-tokens');
    expect(res.status).toBe(200);
    const body = await parseJson<TokenListItem[]>(res);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      id: created.id,
      name: 'Listed',
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      revoked_at: null,
    });
    expect(body[0]).not.toHaveProperty('token');
    expect(body[0]).not.toHaveProperty('token_hash');
  });

  it('DELETE /api/v1/mcp-tokens/:id revokes token', async () => {
    const { app } = createTestApp();
    const createRes = await app.request('/api/v1/mcp-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Revoke' }),
    });
    const created = await parseJson<CreateTokenResponse>(createRes);

    const res = await app.request(`/api/v1/mcp-tokens/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const listRes = await app.request('/api/v1/mcp-tokens');
    const listed = await parseJson<TokenListItem[]>(listRes);
    expect(listed[0]?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('DELETE /api/v1/mcp-tokens/:id returns 404 when missing', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/v1/mcp-tokens/00000000-0000-4000-8000-000000009999', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('revoke via REST makes subsequent MCP call return 401', async () => {
    const { app } = createTestAppWithMcp();
    const createRes = await app.request('/api/v1/mcp-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MCP revoke' }),
    });
    const created = await parseJson<CreateTokenResponse>(createRes);

    const beforeRevoke = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(beforeRevoke.status).not.toBe(401);

    const revokeRes = await app.request(`/api/v1/mcp-tokens/${created.id}`, {
      method: 'DELETE',
    });
    expect(revokeRes.status).toBe(204);

    const afterRevoke = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(afterRevoke.status).toBe(401);
    expect(await parseJson(afterRevoke)).toEqual({ error: 'unauthorized' });
  });
});
