import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Services } from '@plandesk/api';
import { createAddCommentHandler } from './tools/add-comment.js';
import { createAddArtifactCommentHandler } from './tools/add-artifact-comment.js';
import { createAttachFileHandler } from './tools/attach-file.js';
import { createCreateArtifactHandler } from './tools/create-artifact.js';
import { createGetArtifactHandler } from './tools/get-artifact.js';
import { createUpdateArtifactHandler } from './tools/update-artifact.js';
import { createListArtifactsHandler } from './tools/list-artifacts.js';
import { createCompleteAgentRunHandler } from './tools/complete-agent-run.js';
import { createCreateDocumentHandler } from './tools/create-document.js';
import { createCreateEdgeHandler } from './tools/create-edge.js';
import { createCreateShareLinkHandler } from './tools/create-share-link.js';
import { createCreateFolderHandler } from './tools/create-folder.js';
import { createUpdateFolderHandler } from './tools/update-folder.js';
import { createCreateProjectHandler } from './tools/create-project.js';
import { createCreateTaskHandler } from './tools/create-task.js';
import { createCreateNoteHandler } from './tools/create-note.js';
import { createUpdateNoteHandler } from './tools/update-note.js';
import { createGetNoteHandler } from './tools/get-note.js';
import { createListNotesHandler } from './tools/list-notes.js';
import { createGetDocumentHandler } from './tools/get-document.js';
import { createCreateGoalHandler } from './tools/create-goal.js';
import { createGetGoalHandler } from './tools/get-goal.js';
import { createListGoalsHandler } from './tools/list-goals.js';
import {
  createCompleteGoalHandler,
  createPauseGoalHandler,
  createResumeGoalHandler,
} from './tools/goal-lifecycle.js';
import { createGetNextTaskHandler } from './tools/get-next-task.js';
import { createGetProjectHandler } from './tools/get-project.js';
import { createGetTaskHandler } from './tools/get-task.js';
import { createListTasksHandler } from './tools/list-tasks.js';
import { createListTagsHandler } from './tools/list-tags.js';
import { createListCommentsHandler } from './tools/list-comments.js';
import { createListArtifactCommentsHandler } from './tools/list-artifact-comments.js';
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
  attachFileInputSchema,
  createArtifactInputSchema,
  getArtifactInputSchema,
  updateArtifactInputSchema,
  listArtifactsInputSchema,
  completeAgentRunInputSchema,
  createDocumentInputSchema,
  createEdgeInputSchema,
  createFolderInputSchema,
  createShareLinkInputSchema,
  updateFolderInputSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  getDocumentInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  listTagsInputSchema,
  createNoteInputSchema,
  updateNoteInputSchema,
  getNoteInputSchema,
  listNotesInputSchema,
  addCommentInputSchema,
  addArtifactCommentInputSchema,
  createGoalInputSchema,
  getGoalInputSchema,
  listGoalsInputSchema,
  completeGoalInputSchema,
  goalLifecycleInputSchema,
  getNextTaskInputSchema,
  getProjectInputSchema,
  listCommentsInputSchema,
  listArtifactCommentsInputSchema,
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

function createMcpServer(services: Services, origin: string): McpServer {
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
      description:
        'Create a canvas node and task row. Optional `tags` sets the task tags by name; tags that do not exist yet in the project are auto-created.',
      inputSchema: createTaskInputSchema.shape,
    },
    createCreateTaskHandler(services.taskService),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update Task',
      description:
        'Update task status, label, description, position, or tags. `tags` REPLACES the full tag set (auto-creating tags by name that do not exist yet; [] clears all tags); omit it to leave tags unchanged.',
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
    'create_artifact',
    {
      title: 'Create Artifact',
      description:
        'Create an agent-produced deliverable (report, RFC, HTML diagram) stored in the workspace. Humans can annotate it via the CLI previewer; the returned artifact_id is exactly the id used by list_artifact_comments and add_artifact_comment, closing the annotate→read→revise loop.',
      inputSchema: createArtifactInputSchema.shape,
    },
    createCreateArtifactHandler(services.artifactService),
  );

  server.registerTool(
    'get_artifact',
    {
      title: 'Get Artifact',
      description:
        'Get a stored artifact by id, including its full content. Use after list_artifact_comments to read human feedback before revising with update_artifact.',
      inputSchema: getArtifactInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetArtifactHandler(services.artifactService),
  );

  server.registerTool(
    'update_artifact',
    {
      title: 'Update Artifact',
      description:
        'Revise a stored artifact (title, content, or kind). Use after reading artifact comments to incorporate human annotations.',
      inputSchema: updateArtifactInputSchema.shape,
    },
    createUpdateArtifactHandler(services.artifactService),
  );

  server.registerTool(
    'list_artifacts',
    {
      title: 'List Artifacts',
      description:
        'List artifact summaries for a project (id, title, kind, updated_at). Artifacts are agent deliverables humans annotate via the previewer.',
      inputSchema: listArtifactsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListArtifactsHandler(services.artifactService),
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
    'attach_file',
    {
      title: 'Attach File',
      description:
        'Upload a file (image today) and get back a short URL. Embed the returned `url` in a task, document, or comment body as `![alt](url)` instead of inlining base64 — keeps bodies lean. mime defaults to image/png.',
      inputSchema: attachFileInputSchema.shape,
    },
    createAttachFileHandler(services.fileService),
  );

  server.registerTool(
    'create_share_link',
    {
      title: 'Create Share Link',
      description:
        'Mint a public, hash-token share link scoped to a single task or document, with a Markdown URL (`markdown_url`) a worker can `curl` for full context — put "Context: <markdown_url>" in a worker brief instead of pasting. Exactly one of task_id/document_id is required. expires defaults to 24h; never means the link does not expire.',
      inputSchema: createShareLinkInputSchema.shape,
    },
    createCreateShareLinkHandler(services.shareService, () => origin),
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
    'create_goal',
    {
      title: 'Create Goal',
      description: 'Create a goal for a project with an objective and optional contract fields',
      inputSchema: createGoalInputSchema.shape,
    },
    createCreateGoalHandler(services.goalService),
  );

  server.registerTool(
    'get_goal',
    {
      title: 'Get Goal',
      description: 'Get a goal by ID including its cycle-tasks',
      inputSchema: getGoalInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetGoalHandler(services.goalService),
  );

  server.registerTool(
    'list_goals',
    {
      title: 'List Goals',
      description: 'List all goals for a project',
      inputSchema: listGoalsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListGoalsHandler(services.goalService),
  );

  server.registerTool(
    'pause_goal',
    {
      title: 'Pause Goal',
      description: 'Pause an active goal',
      inputSchema: goalLifecycleInputSchema.shape,
    },
    createPauseGoalHandler(services.goalService),
  );

  server.registerTool(
    'resume_goal',
    {
      title: 'Resume Goal',
      description: 'Resume a paused goal',
      inputSchema: goalLifecycleInputSchema.shape,
    },
    createResumeGoalHandler(services.goalService),
  );

  server.registerTool(
    'complete_goal',
    {
      title: 'Complete Goal',
      description:
        'Mark a goal complete when every cycle-task is done and verification evidence is green. Submit evidence matching the goal verification_surface; red evidence blocks the goal and files a remediation task.',
      inputSchema: completeGoalInputSchema.shape,
    },
    createCompleteGoalHandler(services.goalService),
  );

  server.registerTool(
    'get_next_task',
    {
      title: 'Get Next Task',
      description:
        'Return the next actionable todo on the project active goal frontier (or a specific goal via goal_id). Resolves the sole active goal when goal_id is omitted; returns no_active_goal or multiple_active_goals when ambiguous. Optional tags filter uses OR semantics; prerequisite completion is evaluated against all project tasks.',
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
        'List all tasks for a project, optionally filtered by status and/or tags. The `tags` filter uses OR semantics: a task matches if it carries ANY of the given tag names. Use this to reconcile the board against reality.',
      inputSchema: listTasksInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListTasksHandler(services.taskService),
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List Tags',
      description: 'List the tags of a project (name, optional color) for labeling tasks',
      inputSchema: listTagsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListTagsHandler(services.tagService),
  );

  server.registerTool(
    'list_comments',
    {
      title: 'List Comments',
      description: 'List unresolved comments for a project or a document, task, or note',
      inputSchema: listCommentsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListCommentsHandler(services.commentService),
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Add Comment',
      description: 'Leave a suggestion on a document, task, or note',
      inputSchema: addCommentInputSchema.shape,
    },
    createAddCommentHandler(services.commentService),
  );

  server.registerTool(
    'list_artifact_comments',
    {
      title: 'List Artifact Comments',
      description: 'List annotations on a file artifact for a project.',
      inputSchema: listArtifactCommentsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListArtifactCommentsHandler(services.commentService),
  );

  server.registerTool(
    'add_artifact_comment',
    {
      title: 'Add Artifact Comment',
      description:
        'Create an annotation on a file artifact (previewed via `plandesk <file>`). artifact_id is the file identity; anchor is the W3C selector JSON.',
      inputSchema: addArtifactCommentInputSchema.shape,
    },
    createAddArtifactCommentHandler(services.commentService),
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
      description:
        'Register the project on the sync server and store the remote credentials. server_url and sync_token come from the CLI deploy flow: `plandesk deploy <target>` provisions the server and writes the token to .plandesk/sync-token; prefer `plandesk publish --remote <url>` which reads both from the repo binding.',
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
    const origin = new URL(c.req.url).origin;
    const server = createMcpServer(deps.services, origin);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
