import { Hono } from 'hono';
import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { resolvePublicOrigin, tryGetAuthContext, type Services } from '@plandesk/api';
import { createWorkspaceRootsResolver } from './tools/workspace-roots.js';
import { TOOLS } from './tools/table.js';

export type McpAppDeps = {
  services: Services;
  /** Server bind host — gates `file_path` (loopback only). Defaults to loopback. */
  bindHost?: string;
};

function createMcpServer(services: Services, origin: string, bindHost: string): McpServer {
  const server = new McpServer({ name: 'plandesk', version: '1.0.0' });
  const workspaceRoots = createWorkspaceRootsResolver(services.projectService);
  const ctx = {
    origin,
    bindHost,
    filePathDeps: { bindHost, workspaceRoots },
  };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as ZodRawShapeCompat,
        ...(tool.outputSchema !== undefined
          ? { outputSchema: tool.outputSchema as ZodRawShapeCompat }
          : {}),
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      },
      tool.handler(services, ctx) as ToolCallback<ZodRawShapeCompat>,
    );
  }

  return server;
}

export function createMcpApp(deps: McpAppDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    // Parent createApp org-auth already resolved better-auth apiKey/session or
    // loopback owner. MCP never re-auths — no credential → 401.
    if (tryGetAuthContext() !== undefined) {
      await next();
      return;
    }

    return c.json({ error: 'unauthorized' }, 401);
  });

  // Match both `/mcp` and the RFC §4.3 documented `/mcp/` (trailing slash), so
  // every MCP client URL form reaches the transport (auth runs in the `*` mw above).
  app.all('*', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const origin = resolvePublicOrigin(c.req.url);
    const server = createMcpServer(deps.services, origin, deps.bindHost ?? '127.0.0.1');
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
