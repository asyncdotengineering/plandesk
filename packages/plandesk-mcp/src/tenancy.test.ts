import { describe, expect, it } from 'vitest';
import { createApp, createServices } from '@plandesk/api';
import {
  createDb,
  createProject,
  DEFAULT_ORG_ID,
  migrate,
} from '@plandesk/db';
import { createMcpApp } from './server.js';

describe('MCP org tenancy', () => {
  it('test:cross_org_denied — stranger bearer is 401 (no mcp_token auth path)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const projectA = await createProject(db, {
      name: 'Secret A',
      orgId: DEFAULT_ORG_ID,
    });

    const services = createServices({ db });
    const mcpApp = createMcpApp({
      services,
      tokenStore: {
        async verify() {
          return undefined;
        },
      },
    });
    // Hosted bind: no loopback, stranger bearer → 401.
    const app = createApp({ db, services, mcp: mcpApp, bindHost: '0.0.0.0' });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer plandesk_mcp_org_b_stranger',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_project', arguments: { project_id: projectA.id } },
      }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });
});
