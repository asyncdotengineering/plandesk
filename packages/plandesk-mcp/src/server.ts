import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Services } from '@plandesk/api';
import { createCompleteAgentRunHandler } from './tools/complete-agent-run.js';
import { createCreateDocumentHandler } from './tools/create-document.js';
import { createCreateEdgeHandler } from './tools/create-edge.js';
import { createCreateProjectHandler } from './tools/create-project.js';
import { createCreateTaskHandler } from './tools/create-task.js';
import { createGetDocumentHandler } from './tools/get-document.js';
import { createGetProjectHandler } from './tools/get-project.js';
import { createListDocumentsHandler } from './tools/list-documents.js';
import { createListProjectsHandler } from './tools/list-projects.js';
import { createRecordAgentProgressHandler } from './tools/record-agent-progress.js';
import {
  completeAgentRunInputSchema,
  createDocumentInputSchema,
  createEdgeInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  getDocumentInputSchema,
  getProjectInputSchema,
  listDocumentsInputSchema,
  listProjectsInputSchema,
  recordAgentProgressInputSchema,
  startAgentRunInputSchema,
  updateDocumentInputSchema,
  updateTaskInputSchema,
} from './tools/registry.js';
import { createStartAgentRunHandler } from './tools/start-agent-run.js';
import { createUpdateDocumentHandler } from './tools/update-document.js';
import { createUpdateTaskHandler } from './tools/update-task.js';

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

  server.registerTool(
    'create_project',
    {
      title: 'Create Project',
      description: 'Create a new project',
      inputSchema: createProjectInputSchema.shape,
    },
    createCreateProjectHandler(services.projectService),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create Task',
      description: 'Create a canvas node and task row',
      inputSchema: createTaskInputSchema.shape,
    },
    createCreateTaskHandler(services.taskService),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update Task',
      description: 'Update task status, label, description, or position',
      inputSchema: updateTaskInputSchema.shape,
    },
    createUpdateTaskHandler(services.taskService),
  );

  server.registerTool(
    'create_document',
    {
      title: 'Create Document',
      description: 'Create a document with optional linked task',
      inputSchema: createDocumentInputSchema.shape,
    },
    createCreateDocumentHandler(services.documentService),
  );

  server.registerTool(
    'update_document',
    {
      title: 'Update Document',
      description: 'Update document title, body, or status line',
      inputSchema: updateDocumentInputSchema.shape,
    },
    createUpdateDocumentHandler(services.documentService),
  );

  server.registerTool(
    'get_document',
    {
      title: 'Get Document',
      description: 'Get a document by id',
      inputSchema: getDocumentInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetDocumentHandler(services.documentService),
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List Documents',
      description: 'List documents for a project as a tree',
      inputSchema: listDocumentsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListDocumentsHandler(services.documentService),
  );

  server.registerTool(
    'create_edge',
    {
      title: 'Create Edge',
      description: 'Create a canvas edge between two tasks',
      inputSchema: createEdgeInputSchema.shape,
    },
    createCreateEdgeHandler(services.canvasService),
  );

  server.registerTool(
    'start_agent_run',
    {
      title: 'Start Agent Run',
      description: 'Begin an external agent session',
      inputSchema: startAgentRunInputSchema.shape,
    },
    createStartAgentRunHandler(services.agentRunService),
  );

  server.registerTool(
    'record_agent_progress',
    {
      title: 'Record Agent Progress',
      description: 'Append a progress event to an agent run',
      inputSchema: recordAgentProgressInputSchema.shape,
    },
    createRecordAgentProgressHandler(services.agentRunService),
  );

  server.registerTool(
    'complete_agent_run',
    {
      title: 'Complete Agent Run',
      description: 'Close an agent run with completed or failed status',
      inputSchema: completeAgentRunInputSchema.shape,
    },
    createCompleteAgentRunHandler(services.agentRunService),
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
