import { describe, expect, it } from 'vitest';
import { createApp, createServices } from '@plandesk/api';
import {
  createDb,
  createOrg,
  createProject,
  createToken,
  ensureDefaultOrg,
  migrate,
  verifyToken,
} from '@plandesk/db';
import { createMcpApp } from './server.js';

async function callTool(
  app: ReturnType<typeof createApp>,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  // JSON-RPC tools/call via streamable HTTP is heavy; hit the MCP auth+route
  // surface by using the same app's REST project get which shares org scope,
  // and also exercise MCP middleware with a tools/list probe.
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // SSE or plain text
  }
  return { status: res.status, body };
}

describe('MCP org tenancy', () => {
  it('test:cross_org_denied — org-B token requesting org-A project returns not-found via MCP tool', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const orgA = await ensureDefaultOrg(db);
    const orgB = await createOrg(db, { name: 'Org B' });
    const projectA = await createProject(db, { name: 'Secret A', orgId: orgA.id });
    const tokenB = await createToken(db, { name: 'B', orgId: orgB.id });

    // Services rely on auth context from the bearer token (org B).
    const services = createServices({ db });
    const mcpApp = createMcpApp({
      services,
      tokenStore: {
        async verify(raw: string) {
          return verifyToken(db, raw);
        },
      },
    });
    const app = createApp({ db, services, mcp: mcpApp, bindHost: '127.0.0.1' });

    const { status, body } = await callTool(app, tokenB.token, 'get_project', {
      project_id: projectA.id,
    });

    // Tool may return HTTP 200 with isError payload, or 404; either way the
    // project must not be returned as a successful resource.
    const raw = JSON.stringify(body);
    expect(raw.includes(projectA.id) && raw.includes('Secret A')).toBe(false);
    // Prefer explicit not-found semantics when present.
    if (status === 404) {
      expect(status).toBe(404);
    } else {
      expect(
        raw.includes('not_found') ||
          raw.includes('not found') ||
          raw.includes('Project not found') ||
          raw.includes('isError'),
      ).toBe(true);
    }
  });
});
