import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp, createEventBus, createServices } from '@plandesk/api';
import {
  createDb,
  createProject,
  createToken,
  migrate,
  revokeToken,
  verifyToken,
  type Db,
} from '@plandesk/db';
import { createMcpApp } from './server.js';

function createTestTokenStore(db: Db) {
  return {
    verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
}

async function withMcpServer(
  run: (ctx: { baseUrl: string; db: Db; token: string; projectId: string }) => Promise<void>,
): Promise<void> {
  const db = createDb(':memory:');
  migrate(db);
  const project = createProject(db, { name: 'MCP Test Project', description: 'via MCP' });
  const { token } = createToken(db, { name: 'test' });

  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const mcpApp = createMcpApp({ services, tokenStore: createTestTokenStore(db) });
  const app = createApp({ db, eventBus, services, mcp: mcpApp });

  const server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('expected TCP address');
  }

  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  try {
    await run({ baseUrl, db, token, projectId: project.id });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

async function connectClient(baseUrl: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const client = new Client({ name: 'plandesk-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('createMcpApp', () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('returns 401 without Authorization header', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });
  });

  it('returns 401 for revoked token', async () => {
    await withMcpServer(async ({ baseUrl, db }) => {
      const row = createToken(db, { name: 'revoke-me' });
      revokeToken(db, row.id);

      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${row.token}` },
      });
      expect(res.status).toBe(401);
    });
  });

  it('lists read tools and get_project returns snake_case project detail', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      const client = await connectClient(baseUrl, token);

      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(['get_project', 'list_projects']);

      const listed = await client.callTool({ name: 'list_projects', arguments: {} });
      const listContent = listed.content as Array<{ type: string; text?: string }>;
      const listText = listContent[0]?.type === 'text' ? (listContent[0].text ?? '{}') : '{}';
      const listPayload = JSON.parse(listText) as {
        projects: Array<{ id: string; name: string; created_at: string; updated_at: string }>;
      };
      expect(listPayload.projects.some((p) => p.id === projectId)).toBe(true);
      expect(listPayload.projects[0]).toHaveProperty('created_at');

      const detail = await client.callTool({
        name: 'get_project',
        arguments: { project_id: projectId },
      });
      const detailContent = detail.content as Array<{ type: string; text?: string }>;
      const detailText = detailContent[0]?.type === 'text' ? (detailContent[0].text ?? '{}') : '{}';
      const detailPayload = JSON.parse(detailText) as {
        project: { id: string; name: string; summary: Record<string, number> };
      };
      expect(detailPayload.project.id).toBe(projectId);
      expect(detailPayload.project.summary).toBeTruthy();

      await client.close();
    });
  });

  it('returns tool error for missing project', async () => {
    await withMcpServer(async ({ baseUrl, token }) => {
      const client = await connectClient(baseUrl, token);
      const result = await client.callTool({
        name: 'get_project',
        arguments: { project_id: '00000000-0000-4000-8000-000000009999' },
      });
      expect(result.isError).toBe(true);
      await client.close();
    });
  });
});
