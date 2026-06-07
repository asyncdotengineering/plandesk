import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Services } from '@plandesk/api';
import { createGetProjectHandler } from './tools/get-project.js';
import { createListProjectsHandler } from './tools/list-projects.js';
import { getProjectInputSchema, listProjectsInputSchema } from './tools/registry.js';

export type TokenStore = {
  verify(raw: string): { id: string; name: string } | undefined;
};

export type McpAppDeps = {
  services: Services;
  tokenStore: TokenStore;
};

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

function createMcpServer(services: Services): McpServer {
  const server = new McpServer({ name: 'plandesk', version: '1.0.0' });

  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      description: 'List all accessible projects',
      inputSchema: listProjectsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListProjectsHandler(services.projectService),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get Project',
      description: 'Get project detail with task status summary',
      inputSchema: getProjectInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetProjectHandler(services.projectService),
  );

  return server;
}

export function createMcpApp(deps: McpAppDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const raw = extractBearerToken(c.req.header('Authorization'));
    if (raw === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const verified = deps.tokenStore.verify(raw);
    if (!verified) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  // Match both `/mcp` and the RFC §4.3 documented `/mcp/` (trailing slash), so
  // every MCP client URL form reaches the transport (auth runs in the `*` mw above).
  app.all('*', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer(deps.services);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
