import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { tryGetAuthContext, type Services } from '@plandesk/api';
import { createAddCommentHandler } from './tools/add-comment.js';
import { createAddArtifactCommentHandler } from './tools/add-artifact-comment.js';
import { createAttachFileHandler } from './tools/attach-file.js';
import { createWorkspaceRootsResolver } from './tools/workspace-roots.js';
import { createCreateArtifactHandler } from './tools/create-artifact.js';
import { createGetArtifactHandler } from './tools/get-artifact.js';
import { createUpdateArtifactHandler } from './tools/update-artifact.js';
import { createMoveScreenHandler, createCopyScreenHandler } from './tools/move-copy-screen.js';
import { createListArtifactsHandler } from './tools/list-artifacts.js';
import { createCompleteAgentRunHandler } from './tools/complete-agent-run.js';
import { createCreateDocumentHandler } from './tools/create-document.js';
import { createCreateEdgeHandler } from './tools/create-edge.js';
import { createListEdgesHandler } from './tools/list-edges.js';
import { createDeleteEdgeHandler } from './tools/delete-edge.js';
import { createCreateShareLinkHandler } from './tools/create-share-link.js';
import { createCreateFolderHandler } from './tools/create-folder.js';
import { createUpdateFolderHandler } from './tools/update-folder.js';
import { createDeleteFolderHandler } from './tools/delete-folder.js';
import { createMoveDocumentsHandler } from './tools/move-documents.js';
import { createCreatePrototypeHandler } from './tools/create-prototype.js';
import { createListPrototypesHandler } from './tools/list-prototypes.js';
import { createGetPrototypeHandler } from './tools/get-prototype.js';
import { createUpdatePrototypeHandler } from './tools/update-prototype.js';
import { createCreateProjectHandler } from './tools/create-project.js';
import { createUpdateProjectHandler } from './tools/update-project.js';
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
import { createSetCurrentGoalHandler } from './tools/set-current-goal.js';
import { createInvokeGoalHandler } from './tools/invoke-goal.js';
import { createGetTaskGraphHandler } from './tools/get-task-graph.js';
import { createGetProjectHandler } from './tools/get-project.js';
import { createGetTaskHandler } from './tools/get-task.js';
import { createListTasksHandler } from './tools/list-tasks.js';
import { createListTagsHandler } from './tools/list-tags.js';
import { createListViewsHandler } from './tools/list-views.js';
import { createListRevisionsHandler } from './tools/list-revisions.js';
import { createGetRevisionHandler } from './tools/get-revision.js';
import { createListCommentsHandler } from './tools/list-comments.js';
import { createListArtifactCommentsHandler } from './tools/list-artifact-comments.js';
import { createListDocumentsHandler } from './tools/list-documents.js';
import { createListProjectsHandler } from './tools/list-projects.js';
import { createRecordAgentProgressHandler } from './tools/record-agent-progress.js';
import { createListSubmissionsHandler } from './tools/list-submissions.js';
import { createResolveCommentHandler } from './tools/resolve-comment.js';
import { createSearchHandler } from './tools/search.js';
import { createScaffoldProjectFromPlanHandler } from './tools/scaffold-project-from-plan.js';
import { createSyncPullHandler } from './tools/sync-pull.js';
import { createTriageSubmissionHandler } from './tools/triage-submission.js';
import {
  attachFileInputSchema,
  createArtifactInputSchema,
  getArtifactInputSchema,
  updateArtifactInputSchema,
  moveScreenInputSchema,
  copyScreenInputSchema,
  listArtifactsInputSchema,
  completeAgentRunInputSchema,
  createDocumentInputSchema,
  createEdgeInputSchema,
  listEdgesInputSchema,
  deleteEdgeInputSchema,
  createFolderInputSchema,
  createPrototypeInputSchema,
  listPrototypesInputSchema,
  getPrototypeInputSchema,
  updatePrototypeInputSchema,
  createShareLinkInputSchema,
  updateFolderInputSchema,
  deleteFolderInputSchema,
  moveDocumentsInputSchema,
  createProjectInputSchema,
  updateProjectInputSchema,
  createTaskInputSchema,
  getDocumentInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  listTagsInputSchema,
  listViewsInputSchema,
  listRevisionsInputSchema,
  getRevisionInputSchema,
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
  setCurrentGoalInputSchema,
  getNextTaskInputSchema,
  getTaskGraphInputSchema,
  getProjectInputSchema,
  listCommentsInputSchema,
  listArtifactCommentsInputSchema,
  listDocumentsInputSchema,
  listProjectsInputSchema,
  listSubmissionsInputSchema,
  recordAgentProgressInputSchema,
  resolveCommentInputSchema,
  searchInputSchema,
  scaffoldProjectFromPlanInputSchema,
  startAgentRunInputSchema,
  syncPullInputSchema,
  triageSubmissionInputSchema,
  updateDocumentInputSchema,
  updateTaskInputSchema,
  getDocumentOutputSchema,
  listEdgesOutputSchema,
  createEdgeOutputSchema,
} from './tools/registry.js';
import { createStartAgentRunHandler } from './tools/start-agent-run.js';
import { createUpdateDocumentHandler } from './tools/update-document.js';
import { createUpdateTaskHandler } from './tools/update-task.js';

export type McpAppDeps = {
  services: Services;
  /** Server bind host — gates `file_path` (loopback only). Defaults to loopback. */
  bindHost?: string;
};

function createMcpServer(services: Services, origin: string, bindHost: string): McpServer {
  const server = new McpServer({ name: 'plandesk', version: '1.0.0' });
  const workspaceRoots = createWorkspaceRootsResolver(services.projectService);
  const filePathDeps = { bindHost, workspaceRoots };

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
    'update_project',
    {
      title: 'Update Project',
      description:
        'Update project name, description, repo_url, or folder_path. Pass null for repo_url or folder_path to clear them.',
      inputSchema: updateProjectInputSchema.shape,
    },
    createUpdateProjectHandler(services.projectService),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create Task',
      description:
        'Create a canvas node and task row. `lane` and `severity` are typed execution fields; optional `tags` sets task tags by name, auto-creating missing project tags.',
      inputSchema: createTaskInputSchema.shape,
    },
    createCreateTaskHandler(services.taskService),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update Task',
      description:
        'Update task status, label, description, position, goal, typed lane/severity fields, tags, or commit_refs. `goal_id` reassigns the task to a different goal in the same project, preserving its edges, comments, and documents. `tags` REPLACES the full tag set (auto-creating tags by name that do not exist yet; [] clears all tags); omit it to leave tags unchanged. `commit_refs` REPLACES the full array of hex SHAs (case-insensitive, stored lowercase; max 50; pass null to clear); omit to leave unchanged.',
      inputSchema: updateTaskInputSchema.shape,
    },
    createUpdateTaskHandler(services.taskService),
  );

  server.registerTool(
    'create_document',
    {
      title: 'Create Document',
      description:
        'Create a document with optional links and optional folder_id to file it on create (no follow-up move). Pass link_to as a single id or a list of task/document ids to wire document→target edges. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
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
        'Update document title, body, status line, folder, or links. Pass folder_id to move the document into a folder (the MCP equivalent of dragging a row onto a folder in the UI), or null to file it under Unfiled at the project root. Pass link_to as a single id or list of task/document ids to add outgoing document→target edges. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
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
        'Get a document by id, including derived links (outgoing) and backlinks (incoming) so related specs and tasks can be walked without a second query. Each link/backlink entry carries an `edge_id` — pass it to delete_edge to remove that one relationship.',
      inputSchema: getDocumentInputSchema.shape,
      outputSchema: getDocumentOutputSchema,
      annotations: { readOnlyHint: true },
    },
    createGetDocumentHandler(services.documentService),
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List Documents',
      description:
        'List documents for a project with every document in the top-level documents array. The recursive folders array contains metadata-only nodes with id, name, parent_folder_id, doc_count, and nested folders; it never embeds document bodies. Pass folder_id to return only that folder’s documents. Returns summary fields by default; pass verbose: true to include bodies.',
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
        'Create a document folder, optionally nested under a parent folder via parent_folder_id (omit for project root). Folders organize documents; documents reference them via folder_id at create or move time.',
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
    'delete_folder',
    {
      title: 'Delete Folder',
      description:
        'Delete a folder without orphaning contents. By default documents and sub-folders move to the deleted folder\'s parent (Unfiled when it was at the project root). Pass reparent_to null for Unfiled, or a folder id to move contents there.',
      inputSchema: deleteFolderInputSchema.shape,
    },
    createDeleteFolderHandler(services.folderService),
  );

  server.registerTool(
    'move_documents',
    {
      title: 'Move Documents',
      description:
        'Move many documents into a folder in one call (or to Unfiled when folder_id is null). Not atomic: each document_id is attempted independently and the result lists `moved` ids plus per-item `failed` entries — a missing, foreign, or invalid id does not roll back the rest.',
      inputSchema: moveDocumentsInputSchema.shape,
    },
    createMoveDocumentsHandler(services.documentService),
  );

  server.registerTool(
    'create_prototype',
    {
      title: 'Create Prototype',
      description:
        'Create a named prototype flow with a declared viewport. Viewport presets (guidance, not an enum): 390×844 phone, 1024×768 tablet, 1440×900 desktop — free values are allowed. Screens are HTML artifacts attached via create_artifact with prototype_id.',
      inputSchema: createPrototypeInputSchema.shape,
    },
    createCreatePrototypeHandler(services.prototypeService),
  );

  server.registerTool(
    'list_prototypes',
    {
      title: 'List Prototypes',
      description: 'List prototypes for a project (id, name, viewport, timestamps).',
      inputSchema: listPrototypesInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListPrototypesHandler(services.prototypeService),
  );

  server.registerTool(
    'get_prototype',
    {
      title: 'Get Prototype',
      description:
        'Get a prototype by id, including its screens (HTML artifacts with that prototype_id).',
      inputSchema: getPrototypeInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetPrototypeHandler(services.prototypeService),
  );

  server.registerTool(
    'update_prototype',
    {
      title: 'Update Prototype',
      description:
        'Rename a prototype or change its viewport. Viewport presets (guidance): 390×844 phone, 1024×768 tablet, 1440×900 desktop.',
      inputSchema: updatePrototypeInputSchema.shape,
    },
    createUpdatePrototypeHandler(services.prototypeService),
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
    'search',
    {
      title: 'Search',
      description:
        'Search documents, tasks, and notes by title or label within the active workspace (or a single project). Body text is not searched.',
      inputSchema: searchInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createSearchHandler(services.searchService),
  );

  server.registerTool(
    'create_artifact',
    {
      title: 'Create Artifact',
      description:
        "Create an agent-produced deliverable (report, RFC, HTML diagram) stored in the workspace. Pass optional prototype_id (same project) with kind 'html' to attach it as a screen — markdown screens are refused. Do not send x/y; layout is system-owned. Humans can annotate via the CLI previewer; the returned artifact_id is exactly the id used by list_artifact_comments and add_artifact_comment.",
      inputSchema: createArtifactInputSchema.shape,
    },
    createCreateArtifactHandler(services.artifactService, filePathDeps),
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
    createUpdateArtifactHandler(services.artifactService, filePathDeps),
  );

  server.registerTool(
    'move_screen',
    {
      title: 'Move Screen',
      description:
        'Move an html screen to another prototype in the same project. Keeps the artifact id and comments; re-resolves derived links in the destination. Does not rewrite markup.',
      inputSchema: moveScreenInputSchema.shape,
    },
    createMoveScreenHandler(services.artifactService),
  );

  server.registerTool(
    'copy_screen',
    {
      title: 'Copy Screen',
      description:
        'Copy an html screen into another prototype. New artifact id, same content, comments do not travel. Title links resolve in the destination prototype.',
      inputSchema: copyScreenInputSchema.shape,
    },
    createCopyScreenHandler(services.artifactService),
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
      outputSchema: createEdgeOutputSchema,
    },
    createCreateEdgeHandler(services.canvasService),
  );

  server.registerTool(
    'list_edges',
    {
      title: 'List Edges',
      description:
        'List edges for a project with typed endpoints (id, from_type, from_id, to_type, to_id, label). Use this to inspect the graph before pruning a stale edge with delete_edge — each edge `id` here is exactly the edge_id delete_edge takes.',
      inputSchema: listEdgesInputSchema.shape,
      outputSchema: listEdgesOutputSchema,
      annotations: { readOnlyHint: true },
    },
    createListEdgesHandler(services.canvasService),
  );

  server.registerTool(
    'delete_edge',
    {
      title: 'Delete Edge',
      description:
        "Remove one edge by id (the edge_id from a get_document links/backlinks entry or list_edges). Only the addressed edge is deleted; sibling edges on the same entity stay intact. Updates get_next_task's blocked/waiting_on computation immediately for task-graph edges.",
      inputSchema: deleteEdgeInputSchema.shape,
      annotations: {
        destructiveHint: true,
        // Re-deleting an already-removed edge is a no-op (returns not_found);
        // no further data changes, so a retry is safe.
        idempotentHint: true,
      },
    },
    createDeleteEdgeHandler(services.canvasService),
  );

  server.registerTool(
    'attach_file',
    {
      title: 'Attach File',
      description:
        'Upload a file (image today) and get back a short URL. Embed the returned `url` in a task, document, or comment body as `![alt](url)` instead of inlining base64 — keeps bodies lean. mime defaults to image/png. On loopback, `file_path` reads from disk only when the path resolves under a project repo root registered in this workspace (`folder_path`); otherwise use `content_base64`.',
      inputSchema: attachFileInputSchema.shape,
    },
    createAttachFileHandler(services.fileService, filePathDeps),
  );

  server.registerTool(
    'create_share_link',
    {
      title: 'Create Share Link',
      description:
        'Mint a public, hash-token share link scoped to a single task, document, or prototype, with a Markdown URL (`markdown_url`) a worker can `curl` for full context — put "Context: <markdown_url>" in a worker brief instead of pasting. Exactly one of task_id/document_id/prototype_id is required. expires defaults to 24h; never means the link does not expire.',
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
      description: 'Create a goal for a project with an optional short unique name, objective, and contract fields',
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
        "Edit an existing goal's name, objective, or contract fields (verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget). Does not detach the goal's cycle-tasks. Omit a field to leave it unchanged.",
      inputSchema: updateGoalInputSchema.shape,
    },
    createUpdateGoalHandler(services.goalService),
  );

  server.registerTool(
    'set_current_goal',
    {
      title: 'Set Current Goal',
      description:
        'Point the project current_goal_id at this active goal so get_next_task resolves here when goal_id is omitted.',
      inputSchema: setCurrentGoalInputSchema.shape,
    },
    createSetCurrentGoalHandler(services.goalService),
  );

  server.registerTool(
    'invoke_goal',
    {
      title: 'Invoke Goal',
      description:
        'Begin working a goal: sets current_goal_id, checks the task graph for cycles, and returns the first frontier todo. Fails with no_todo_tasks when tasks are still in scope (release scope → todo explicitly — this tool does not self-release). Other active goals remain active; warnings explain how get_next_task resolves.',
      inputSchema: goalLifecycleInputSchema.shape,
    },
    createInvokeGoalHandler(services.goalService),
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
        "Return the next actionable todo on the project active goal frontier (or a specific goal via goal_id or project-scoped goal name). When both are omitted: resolves via current_goal_id, then the sole active goal, then ambiguous_goal — never unions active goals. Optional tags filter uses OR semantics; prerequisite completion is evaluated against all project tasks. Does not claim — call claim_task on the candidate.",
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
    'get_task_graph',
    {
      title: 'Get Task Graph',
      description:
        'Return the task dependency graph with prerequisite fan-in, depth, roots, detected cycles, and the tasks actionable if every scope task were released. Optionally scope to one goal.',
      inputSchema: getTaskGraphInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetTaskGraphHandler(services.taskService),
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
        'List all tasks for a project, optionally filtered by status, typed lane/severity, and/or tags. The `tags` filter uses OR semantics: a task matches if it carries ANY of the given tag names. Use this to reconcile the board against reality. Returns summary fields by default; pass verbose: true to include descriptions.',
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
    'list_views',
    {
      title: 'List Views',
      description:
        'List saved named views for a project (name + config). Views are human-authored named queries — agents consume them via this read-only tool; there is no create/update/delete view tool.',
      inputSchema: listViewsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListViewsHandler(services.viewService),
  );

  server.registerTool(
    'list_revisions',
    {
      title: 'List Revisions',
      description:
        'List content-history metadata for a task or document (id, author, changed fields, timestamp). Newest first. Does not include snapshot bodies — use get_revision for those.',
      inputSchema: listRevisionsInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createListRevisionsHandler(services.revisionService),
  );

  server.registerTool(
    'get_revision',
    {
      title: 'Get Revision',
      description:
        'Get one content-history revision including its full prior-state snapshot. Read-only — there is no restore tool over MCP.',
      inputSchema: getRevisionInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createGetRevisionHandler(services.revisionService),
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
    const server = createMcpServer(deps.services, origin, deps.bindHost ?? '127.0.0.1');
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
