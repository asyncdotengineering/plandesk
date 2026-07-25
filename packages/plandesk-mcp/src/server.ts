import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  tryGetAuthContext,
  type Services,
} from '@plandesk/api';
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
import { createListEdgesHandler } from './tools/list-edges.js';
import { createDeleteEdgeHandler } from './tools/delete-edge.js';
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
import { createUpdateGoalHandler } from './tools/update-goal.js';
import {
  createCompleteGoalHandler,
  createPauseGoalHandler,
  createResumeGoalHandler,
} from './tools/goal-lifecycle.js';
import { createClaimTaskHandler } from './tools/claim-task.js';
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
import { createResolveCommentHandler } from './tools/resolve-comment.js';
import { createScaffoldProjectFromPlanHandler } from './tools/scaffold-project-from-plan.js';
import { createSyncPullHandler } from './tools/sync-pull.js';
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
  listEdgesInputSchema,
  deleteEdgeInputSchema,
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
  updateGoalInputSchema,
  claimTaskInputSchema,
  completeGoalInputSchema,
  goalLifecycleInputSchema,
  getNextTaskInputSchema,
  getProjectInputSchema,
  listCommentsInputSchema,
  listArtifactCommentsInputSchema,
  listDocumentsInputSchema,
  listProjectsInputSchema,
  listSubmissionsInputSchema,
  recordAgentProgressInputSchema,
  resolveCommentInputSchema,
  scaffoldProjectFromPlanInputSchema,
  startAgentRunInputSchema,
  syncPullInputSchema,
  triageSubmissionInputSchema,
  updateDocumentInputSchema,
  updateTaskInputSchema,
} from './tools/registry.js';
import { createStartAgentRunHandler } from './tools/start-agent-run.js';
import { createUpdateDocumentHandler } from './tools/update-document.js';
import { createUpdateTaskHandler } from './tools/update-task.js';

export type McpAppDeps = {
  services: Services;
};

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
        'Update task status, label, description, position, goal, or tags. `goal_id` reassigns the task to a different goal in the same project, preserving its edges, comments, and documents. `tags` REPLACES the full tag set (auto-creating tags by name that do not exist yet; [] clears all tags); omit it to leave tags unchanged.',
      inputSchema: updateTaskInputSchema.shape,
    },
    createUpdateTaskHandler(services.taskService),
  );

  server.registerTool(
    'create_document',
    {
      title: 'Create Document',
      description:
        'Create a document with optional links. Pass link_to as a single id or a list of task/document ids to wire multiple targets; linked_task_id still sets the primary task. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
      inputSchema: createDocumentInputSchema.shape,
    },
    createCreateDocumentHandler(
      services.documentService,
      services.canvasService,
      services.taskService,
    ),
  );

  server.registerTool(
    'update_document',
    {
      title: 'Update Document',
      description:
        'Update document title, body, status line, or links. Pass link_to as a single id or list of task/document ids to add outgoing links; linked_task_id still manages the primary task. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
      inputSchema: updateDocumentInputSchema.shape,
    },
    createUpdateDocumentHandler(
      services.documentService,
      services.canvasService,
      services.taskService,
    ),
  );

  server.registerTool(
    'get_document',
    {
      title: 'Get Document',
      description:
        'Get a document by id, including derived links (outgoing) and backlinks (incoming) so related specs and tasks can be walked without a second query.',
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
        'List documents for a project as a folder tree (folders with nested documents, plus root documents). Pass folder_id to list only the documents inside one folder. Pass compact: true to omit body and return only summary fields — use this to avoid overflowing token limits on large boards.',
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
      description:
        "Create a directed edge between any two entities via from_type/from_id/to_type/to_id (entity types: 'task' or 'document'). Legacy from_task_id/to_task_id still accepted and map to type task. Prefer the label vocabulary: blocks, depends_on, unblocks, feeds, clarifies, enables, supports, documents, references, supersedes, extends.",
      inputSchema: createEdgeInputSchema.shape,
    },
    createCreateEdgeHandler(services.canvasService),
  );

  server.registerTool(
    'list_edges',
    {
      title: 'List Edges',
      description:
        'List edges for a project with typed endpoints (id, from_type, from_id, to_type, to_id, label, plus legacy from_task_id/to_task_id). Use this to inspect the graph before pruning a stale edge with delete_edge.',
      inputSchema: listEdgesInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListEdgesHandler(services.canvasService),
  );

  server.registerTool(
    'delete_edge',
    {
      title: 'Delete Edge',
      description:
        "Remove one edge by id. Only the addressed edge is deleted; sibling edges on the same entity stay intact. Updates get_next_task's blocked/waiting_on computation immediately for task-graph edges.",
      inputSchema: deleteEdgeInputSchema.shape,
    },
    createDeleteEdgeHandler(services.canvasService),
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
        'Scaffold tasks, dependency edges, and linked documents in one atomic call — into a new project, or into an existing one when project_id is given (e.g. the repo-bound project). Each document may take link_to as a single plan key or a list of task/document keys (resolved via key_to_id); give documents a key to reference them from other documents.',
      inputSchema: scaffoldProjectFromPlanInputSchema.shape,
    },
    createScaffoldProjectFromPlanHandler(
      services.projectService,
      services.canvasService,
      services.documentService,
    ),
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
    'update_goal',
    {
      title: 'Update Goal',
      description:
        'Edit an existing goal\'s objective or contract fields (verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget). Does not detach the goal\'s cycle-tasks. Omit a field to leave it unchanged.',
      inputSchema: updateGoalInputSchema.shape,
    },
    createUpdateGoalHandler(services.goalService),
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
        'Return the next actionable todo on the project active goal frontier (or a specific goal via goal_id). When goal_id is omitted: with one active goal, scopes to it; with multiple active goals, considers the union of every active goal\'s tasks instead of dead-ending — returns no_active_goal only when zero goals are active. Optional tags filter uses OR semantics; prerequisite completion is evaluated against all project tasks. Does not claim — call claim_task on the candidate.',
      inputSchema: getNextTaskInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetNextTaskHandler(services.taskService),
  );

  server.registerTool(
    'claim_task',
    {
      title: 'Claim Task',
      description:
        'Atomically claim a todo task for an agent (status → in_progress, assignee = agent_ref). Exactly one concurrent claim wins; losers get claimed: false.',
      inputSchema: claimTaskInputSchema.shape,
    },
    createClaimTaskHandler(services.taskService),
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
        'List all tasks for a project, optionally filtered by status and/or tags. The `tags` filter uses OR semantics: a task matches if it carries ANY of the given tag names. Use this to reconcile the board against reality. Pass compact: true to omit description and return only summary fields — use this to avoid overflowing token limits on large boards.',
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
      async (projectId) => (await services.projectService.get(projectId)) !== undefined,
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
    const origin = new URL(c.req.url).origin;
    const server = createMcpServer(deps.services, origin);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
