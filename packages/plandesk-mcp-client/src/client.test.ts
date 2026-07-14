import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { createApp, createServices } from '@plandesk/api';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  createTokenInDefaultOrg as createToken,
  migrate,
  revokeToken,
  verifyToken,
  type Db,
} from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { createPlandeskClient } from './client.js';

function createTestTokenStore(db: Db) {
  return {
    async verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
}

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
  const { token } = await createToken(db, { name: 'factory-adapter' });

    const services = createServices({ db, orgId: project.orgId });
  const mcpApp = createMcpApp({ services, tokenStore: createTestTokenStore(db) });
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

  it('throws when PLANDESK_MCP_TOKEN is missing', async () => {
    delete process.env.PLANDESK_MCP_TOKEN;
    await expect(createPlandeskClient({ url: 'http://127.0.0.1:3847' })).rejects.toThrow(
      /PLANDESK_MCP_TOKEN is required/,
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

  it('surfaces 401 for revoked token', async () => {
    await withMcpServer(async ({ baseUrl, db }) => {
      const row = await createToken(db, { name: 'revoked' });
      await revokeToken(db, row.id);

      await expect(createPlandeskClient({ url: baseUrl, token: row.token })).rejects.toThrow(
        /401|authentication failed/i,
      );
    });
  });
});

describe('test:factory_adapter_smoke', () => {
  it('lists at least one project over MCP against a real server', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId, projectName }) => {
      const client = await createPlandeskClient({ url: baseUrl, token });
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

  it('reads PLANDESK_URL and PLANDESK_MCP_TOKEN from the environment', async () => {
    await withMcpServer(async ({ baseUrl, token, projectId }) => {
      process.env.PLANDESK_URL = baseUrl;
      process.env.PLANDESK_MCP_TOKEN = token;

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
