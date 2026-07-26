import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { createApp, createServices } from '@plandesk/api';
import {
  DEFAULT_ORG_ID,
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { createPlandeskClient } from './client.js';

async function withMcpServer(
  run: (ctx: {
    baseUrl: string;
    db: Db;
    token: string;
    projectId: string;
    projectName: string;
  }) => Promise<void>,
): Promise<void> {
  const db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, {
    name: 'Factory Adapter Project',
    description: 'via MCP client',
  });
  const token = '';

  const services = createServices({ db, orgId: project.orgId });
  const mcpApp = createMcpApp({ services });
  const app = createApp({ db, services, mcp: mcpApp });

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
    await run({
      baseUrl,
      db,
      token,
      projectId: project.id,
      projectName: project.name,
    });
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

describe('createPlandeskClient', () => {
  const originalToken = process.env.PLANDESK_MCP_TOKEN;
  const originalUrl = process.env.PLANDESK_URL;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.PLANDESK_MCP_TOKEN;
    } else {
      process.env.PLANDESK_MCP_TOKEN = originalToken;
    }
    if (originalUrl === undefined) {
      delete process.env.PLANDESK_URL;
    } else {
      process.env.PLANDESK_URL = originalUrl;
    }
  });

  it('surfaces unreachable server errors without a token (loopback path)', async () => {
    delete process.env.PLANDESK_MCP_TOKEN;
    await expect(createPlandeskClient({ url: 'http://127.0.0.1:1' })).rejects.toThrow(
      /unreachable/i,
    );
  });

  it('surfaces unreachable server errors', async () => {
    await expect(
      createPlandeskClient({
        url: 'http://127.0.0.1:1',
        token: 'plandesk_mcp_test_unreachable',
      }),
    ).rejects.toThrow(/unreachable/i);
  });

  it('surfaces an actionable error when the endpoint returns HTML instead of JSON-RPC', async () => {
    // Simulate a foreign server (e.g. a web UI on a port owned by another
    // project) answering /mcp/ with an HTML page. The raw SDK failure is an
    // opaque "Unexpected content type"/parse error; the client must translate it.
    const htmlServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body>Plan Desk web UI</body></html>');
    });
    await new Promise<void>((resolve) => {
      htmlServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = htmlServer.address();
    if (address === null || typeof address !== 'object') {
      throw new Error('expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    try {
      await expect(
        createPlandeskClient({ url: baseUrl, token: 'plandesk_mcp_probe_token' }),
      ).rejects.toThrow(/non-JSON|not serving|HTML page/i);
    } finally {
      await new Promise<void>((resolve) => {
        htmlServer.close(() => {
          resolve();
        });
      });
    }
  });

  it('surfaces 401 for unknown bearer token', async () => {
    await withMcpServer(async ({ baseUrl }) => {
      await expect(
        createPlandeskClient({ url: baseUrl, token: 'plandesk_mcp_unknown' }),
      ).rejects.toThrow(/401|authentication failed/i);
    });
  });
});

describe('test:factory_adapter_smoke', () => {
  it('lists at least one project over MCP against a real server', async () => {
    await withMcpServer(async ({ baseUrl, projectId, projectName }) => {
      // Local loopback: no token (BA7-1a).
      const client = await createPlandeskClient({ url: baseUrl });
      try {
        const projects = await client.listProjects();
        expect(projects.length).toBeGreaterThanOrEqual(1);
        expect(projects.some((project) => project.id === projectId)).toBe(true);
        expect(projects[0]).toHaveProperty('created_at');

        const detail = await client.getProject(projectId);
        expect(detail.id).toBe(projectId);
        expect(detail.name).toBe(projectName);
        expect(detail.summary).toBeTruthy();
      } finally {
        await client.close();
      }
    });
  });

  it('reads PLANDESK_URL from the environment (loopback needs no token)', async () => {
    await withMcpServer(async ({ baseUrl, projectId }) => {
      process.env.PLANDESK_URL = baseUrl;
      delete process.env.PLANDESK_MCP_TOKEN;

      const client = await createPlandeskClient();
      try {
        const projects = await client.listProjects();
        expect(projects.some((project) => project.id === projectId)).toBe(true);
      } finally {
        await client.close();
      }
    });
  });
});

describe('MCP loopback workspace scoping via in-process server', () => {
  it('list_projects with x-plandesk-workspace-id returns only that workspace', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const wsA = crypto.randomUUID();
    const wsB = crypto.randomUUID();
    const projectA = await createProject(db, { name: 'Project A', workspaceId: wsA });
    await createProject(db, { name: 'Project B', workspaceId: wsB });

    const services = createServices({ db, orgId: DEFAULT_ORG_ID });
    const mcpApp = createMcpApp({ services });
    const app = createApp({ db, services, mcp: mcpApp, bindHost: '127.0.0.1' });

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-plandesk-workspace-id': wsA,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice('data: '.length)) as {
      result?: { content: Array<{ type: string; text: string }> };
    };
    const contentText = parsed.result?.content[0]?.text;
    expect(contentText).toBeDefined();
    const body = JSON.parse(contentText!) as { projects: Array<{ id: string; name: string }> };
    expect(body.projects.some((p) => p.id === projectA.id)).toBe(true);
    expect(body.projects.every((p) => p.name === 'Project A')).toBe(true);
  });
});
