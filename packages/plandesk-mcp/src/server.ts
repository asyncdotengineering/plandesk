import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Services } from '@plandesk/api';
import { createAddCommentHandler } from './tools/add-comment.js';
import { createCompleteAgentRunHandler } from './tools/complete-agent-run.js';
import { createCreateDocumentHandler } from './tools/create-document.js';
import { createCreateEdgeHandler } from './tools/create-edge.js';
import { createCreateFolderHandler } from './tools/create-folder.js';
import { createUpdateFolderHandler } from './tools/update-folder.js';
import { createCreateProjectHandler } from './tools/create-project.js';
import { createCreateTaskHandler } from './tools/create-task.js';
import { createCreateNoteHandler } from './tools/create-note.js';
import { createUpdateNoteHandler } from './tools/update-note.js';
import { createGetNoteHandler } from './tools/get-note.js';
import { createListNotesHandler } from './tools/list-notes.js';
import { createGetDocumentHandler } from './tools/get-document.js';
import { createGetNextTaskHandler } from './tools/get-next-task.js';
import { createGetProjectHandler } from './tools/get-project.js';
import { createGetTaskHandler } from './tools/get-task.js';
import { createListTasksHandler } from './tools/list-tasks.js';
import { createListCommentsHandler } from './tools/list-comments.js';
import { createListDocumentsHandler } from './tools/list-documents.js';
import { createListProjectsHandler } from './tools/list-projects.js';
import { createRecordAgentProgressHandler } from './tools/record-agent-progress.js';
import { createListSubmissionsHandler } from './tools/list-submissions.js';
import { createPublishProjectHandler } from './tools/publish-project.js';
import { createResolveCommentHandler } from './tools/resolve-comment.js';
import { createScaffoldProjectFromPlanHandler } from './tools/scaffold-project-from-plan.js';
import { createSyncPullHandler } from './tools/sync-pull.js';
import { createSyncPushHandler } from './tools/sync-push.js';
import { createTriageSubmissionHandler } from './tools/triage-submission.js';
import {
  completeAgentRunInputSchema,
  createDocumentInputSchema,
  createEdgeInputSchema,
  createFolderInputSchema,
  updateFolderInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  getDocumentInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  createNoteInputSchema,
  updateNoteInputSchema,
  getNoteInputSchema,
  listNotesInputSchema,
  addCommentInputSchema,
  getNextTaskInputSchema,
  getProjectInputSchema,
  listCommentsInputSchema,
  listDocumentsInputSchema,
  listProjectsInputSchema,
  listSubmissionsInputSchema,
  publishProjectInputSchema,
  recordAgentProgressInputSchema,
  resolveCommentInputSchema,
  scaffoldProjectFromPlanInputSchema,
  startAgentRunInputSchema,
  syncPullInputSchema,
  syncPushInputSchema,
  triageSubmissionInputSchema,
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
      description:
        'Create a document with optional linked task. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
      inputSchema: createDocumentInputSchema.shape,
    },
    createCreateDocumentHandler(services.documentService),
  );

  server.registerTool(
    'update_document',
    {
      title: 'Update Document',
      description:
        'Update document title, body, or status line. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
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
      description:
        'List documents for a project as a folder tree (folders with nested documents, plus root documents). Pass folder_id to list only the documents inside one folder.',
      inputSchema: listDocumentsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListDocumentsHandler(services.documentService),
  );

  server.registerTool(
    'create_folder',
    {
      title: 'Create Folder',
      description:
        'Create a document folder, optionally nested under a parent folder. Folders organize documents; documents reference them via folder_id.',
      inputSchema: createFolderInputSchema.shape,
    },
    createCreateFolderHandler(services.folderService),
  );

  server.registerTool(
    'update_folder',
    {
      title: 'Update Folder',
      description:
        'Rename a folder or re-parent it (pass parent_folder_id null to move it to the project root). Re-parenting that would create a cycle is rejected.',
      inputSchema: updateFolderInputSchema.shape,
    },
    createUpdateFolderHandler(services.folderService),
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create Note',
      description:
        'Create a free-form project note. Notes are working notes scoped to the project (findings, context, anything worth referring back to) — not formal documents. Write the body as well-structured Markdown; it is rendered as rich text.',
      inputSchema: createNoteInputSchema.shape,
    },
    createCreateNoteHandler(services.noteService),
  );

  server.registerTool(
    'update_note',
    {
      title: 'Update Note',
      description:
        'Update a project note title or body. Write the body as well-structured Markdown; it is rendered as rich text.',
      inputSchema: updateNoteInputSchema.shape,
    },
    createUpdateNoteHandler(services.noteService),
  );

  server.registerTool(
    'get_note',
    {
      title: 'Get Note',
      description: 'Get a project note by id',
      inputSchema: getNoteInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetNoteHandler(services.noteService),
  );

  server.registerTool(
    'list_notes',
    {
      title: 'List Notes',
      description: 'List the working notes for a project',
      inputSchema: listNotesInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListNotesHandler(services.noteService),
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

  server.registerTool(
    'scaffold_project_from_plan',
    {
      title: 'Scaffold Project From Plan',
      description:
        'Create a project with tasks, dependency edges, and linked documents in one atomic call',
      inputSchema: scaffoldProjectFromPlanInputSchema.shape,
    },
    createScaffoldProjectFromPlanHandler(services.projectService),
  );

  server.registerTool(
    'get_next_task',
    {
      title: 'Get Next Task',
      description: 'Return the next actionable todo task whose prerequisites are all done',
      inputSchema: getNextTaskInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetNextTaskHandler(services.taskService),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get Task',
      description: 'Get a single task by ID including its current status, label, and description',
      inputSchema: getTaskInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetTaskHandler(services.taskService),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List Tasks',
      description:
        'List all tasks for a project, optionally filtered by status. Use this to reconcile the board against reality.',
      inputSchema: listTasksInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListTasksHandler(services.taskService),
  );

  server.registerTool(
    'list_comments',
    {
      title: 'List Comments',
      description: 'List unresolved document comments for a project or document',
      inputSchema: listCommentsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListCommentsHandler(services.commentService, services.documentService),
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Add Comment',
      description: 'Leave a suggestion on a document',
      inputSchema: addCommentInputSchema.shape,
    },
    createAddCommentHandler(services.commentService),
  );

  server.registerTool(
    'resolve_comment',
    {
      title: 'Resolve Comment',
      description: 'Mark document feedback as addressed',
      inputSchema: resolveCommentInputSchema.shape,
    },
    createResolveCommentHandler(services.commentService),
  );

  server.registerTool(
    'publish_project',
    {
      title: 'Publish Project',
      description: 'Register the project on the sync server and store the remote credentials. server_url and sync_token come from the CLI deploy flow: `plandesk deploy <target>` provisions the server and writes the token to .plandesk/sync-token; prefer `plandesk publish --remote <url>` which reads both from the repo binding.',
      inputSchema: publishProjectInputSchema.shape,
    },
    createPublishProjectHandler(services.syncService),
  );

  server.registerTool(
    'sync_push',
    {
      title: 'Sync Push',
      description: 'Push client projections to the hosted sync server',
      inputSchema: syncPushInputSchema.shape,
    },
    createSyncPushHandler(services.syncService),
  );

  server.registerTool(
    'sync_pull',
    {
      title: 'Sync Pull',
      description: 'Pull participant submissions into the local triage inbox',
      inputSchema: syncPullInputSchema.shape,
    },
    createSyncPullHandler(services.syncService),
  );

  server.registerTool(
    'list_submissions',
    {
      title: 'List Submissions',
      description: 'List pulled participant submissions for triage',
      inputSchema: listSubmissionsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListSubmissionsHandler(
      services.syncService,
      (projectId) => services.projectService.get(projectId) !== undefined,
    ),
  );

  server.registerTool(
    'triage_submission',
    {
      title: 'Triage Submission',
      description: 'Accept or reject a participant submission',
      inputSchema: triageSubmissionInputSchema.shape,
    },
    createTriageSubmissionHandler(services.syncService),
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
