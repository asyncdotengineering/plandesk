import type { Services } from '@plandesk/api';
import { InvalidArgumentError, type ShareSubmissionStatus } from '@plandesk/db';
import { linkEntityTypes } from '@plandesk/db/vocabulary';
import { toolInvalidArgument, type ToolResult } from './result.js';
import { serviceTool, serviceToolPayload } from './service-tool.js';
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
  checkReferencesInputSchema,
  scaffoldProjectFromPlanInputSchema,
  startAgentRunInputSchema,
  triageSubmissionInputSchema,
  updateDocumentInputSchema,
  updateTaskInputSchema,
  getDocumentOutputSchema,
  listEdgesOutputSchema,
  createEdgeOutputSchema,
} from './registry.js';
import { createAddCommentHandler } from './add-comment.js';
import { createAddArtifactCommentHandler } from './add-artifact-comment.js';
import { createAttachFileHandler } from './attach-file.js';
import { createWorkspaceRootsResolver } from './workspace-roots.js';
import { createCreateArtifactHandler } from './create-artifact.js';
import { createUpdateArtifactHandler } from './update-artifact.js';
import { createMoveScreenHandler, createCopyScreenHandler } from './move-copy-screen.js';
import { createCreateDocumentHandler } from './create-document.js';
import { createCreateEdgeHandler } from './create-edge.js';
import { createCreateShareLinkHandler } from './create-share-link.js';
import { createMoveDocumentsHandler } from './move-documents.js';
import { createCreatePrototypeHandler } from './create-prototype.js';
import { createUpdatePrototypeHandler } from './update-prototype.js';
import { createCreateProjectHandler } from './create-project.js';
import { createUpdateProjectHandler } from './update-project.js';
import { createCreateTaskHandler } from './create-task.js';
import { createListNotesHandler } from './list-notes.js';
import { createCreateGoalHandler } from './create-goal.js';
import { createGetGoalHandler } from './get-goal.js';
import { createUpdateGoalHandler } from './update-goal.js';
import {
  createCompleteGoalHandler,
  createPauseGoalHandler,
  createResumeGoalHandler,
} from './goal-lifecycle.js';
import { createGetNextTaskHandler } from './get-next-task.js';
import { createInvokeGoalHandler } from './invoke-goal.js';
import { createListTasksHandler } from './list-tasks.js';
import { createListCommentsHandler } from './list-comments.js';
import { createListDocumentsHandler } from './list-documents.js';
import { createSearchHandler } from './search.js';
import { createScaffoldProjectFromPlanHandler } from './scaffold-project-from-plan.js';
import { createTriageSubmissionHandler } from './triage-submission.js';
import { createUpdateDocumentHandler } from './update-document.js';
import { createUpdateTaskHandler } from './update-task.js';

const LINK_ENTITY_TYPE_LIST = linkEntityTypes.map((type) => `'${type}'`).join(', ');

export type McpToolContext = {
  origin: string;
  filePathDeps: {
    bindHost: string;
    workspaceRoots: ReturnType<typeof createWorkspaceRootsResolver>;
  };
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  outputSchema?: object;
  annotations?: Record<string, unknown>;
  handler: (services: Services, ctx: McpToolContext) => unknown;
};

const DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'list_projects',
    title: 'List Projects',
    description: 'List all accessible projects',
    inputSchema: listProjectsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceToolPayload(async () => ({ projects: await services.projectService.list() })),
  },
  {
    name: 'get_project',
    title: 'Get Project',
    description: 'Get project detail with task status summary',
    inputSchema: getProjectInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ project_id }: { project_id: string }) => services.projectService.get(project_id),
        'project',
      ),
  },
  {
    name: 'create_project',
    title: 'Create Project',
    description: 'Create a new project',
    inputSchema: createProjectInputSchema,
    handler: (services) => createCreateProjectHandler(services.projectService),
  },
  {
    name: 'update_project',
    title: 'Update Project',
    description:
      'Update project name, description, repo_url, or folder_path. Pass null for repo_url or folder_path to clear them.',
    inputSchema: updateProjectInputSchema,
    handler: (services) => createUpdateProjectHandler(services.projectService),
  },
  {
    name: 'create_task',
    title: 'Create Task',
    description:
      'Create a canvas node and task row. `lane` and `severity` are typed execution fields; optional `tags` sets task tags by name, auto-creating missing project tags.',
    inputSchema: createTaskInputSchema,
    handler: (services) => createCreateTaskHandler(services.taskService),
  },
  {
    name: 'update_task',
    title: 'Update Task',
    description:
      'Update task status, label, description, position, goal, typed lane/severity fields, tags, or commit_refs. `goal_id` reassigns the task to a different goal in the same project, preserving its edges, comments, and documents. `tags` REPLACES the full tag set (auto-creating tags by name that do not exist yet; [] clears all tags); omit it to leave tags unchanged. `commit_refs` REPLACES the full array of hex SHAs (case-insensitive, stored lowercase; max 50; pass null to clear); omit to leave unchanged.',
    inputSchema: updateTaskInputSchema,
    handler: (services) => createUpdateTaskHandler(services.taskService),
  },
  {
    name: 'create_document',
    title: 'Create Document',
    description:
      'Create a document with optional links and optional folder_id to file it on create (no follow-up move). Pass link_to as a single id or a list of task/document ids to wire document→target edges. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
    inputSchema: createDocumentInputSchema,
    handler: (services) =>
      createCreateDocumentHandler(
        services.documentService,
        services.canvasService,
        services.taskService,
      ),
  },
  {
    name: 'update_document',
    title: 'Update Document',
    description:
      'Update document title, body, status line, folder, or links. Pass folder_id to move the document into a folder (the MCP equivalent of dragging a row onto a folder in the UI), or null to file it under Unfiled at the project root. Pass link_to as a single id or list of task/document ids to add outgoing document→target edges. Write the body as well-structured Markdown (headings, lists, blank lines); it is rendered as rich text.',
    inputSchema: updateDocumentInputSchema,
    handler: (services) =>
      createUpdateDocumentHandler(
        services.documentService,
        services.canvasService,
        services.taskService,
      ),
  },
  {
    name: 'get_document',
    title: 'Get Document',
    description:
      'Get a document by id, including derived links (outgoing) and backlinks (incoming) so related specs and tasks can be walked without a second query. Each link/backlink entry carries an `edge_id` — pass it to delete_edge to remove that one relationship.',
    inputSchema: getDocumentInputSchema,
    outputSchema: getDocumentOutputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ document_id }: { document_id: string }) => services.documentService.get(document_id),
        'document',
      ),
  },
  {
    name: 'list_documents',
    title: 'List Documents',
    description:
      'List documents for a project with every document in the top-level documents array. The recursive folders array contains metadata-only nodes with id, name, parent_folder_id, doc_count, and nested folders; it never embeds document bodies. Pass folder_id to return only that folder’s documents. Returns summary fields by default; pass verbose: true to include bodies.',
    inputSchema: listDocumentsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createListDocumentsHandler(services.documentService),
  },
  {
    name: 'create_folder',
    title: 'Create Folder',
    description:
      'Create a document folder, optionally nested under a parent folder via parent_folder_id (omit for project root). Folders organize documents; documents reference them via folder_id at create or move time.',
    inputSchema: createFolderInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { project_id: string; name: string; parent_folder_id?: string }) =>
          services.folderService.create(args.project_id, {
            name: args.name,
            ...(args.parent_folder_id !== undefined
              ? { parentFolderId: args.parent_folder_id }
              : {}),
          }),
        'folder',
      ),
  },
  {
    name: 'update_folder',
    title: 'Update Folder',
    description:
      'Rename a folder or re-parent it (pass parent_folder_id null to move it to the project root). Re-parenting that would create a cycle is rejected.',
    inputSchema: updateFolderInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { folder_id: string; name?: string; parent_folder_id?: string | null }) =>
          services.folderService.update(args.folder_id, {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.parent_folder_id !== undefined
              ? { parentFolderId: args.parent_folder_id }
              : {}),
          }),
        'folder',
      ),
  },
  {
    name: 'delete_folder',
    title: 'Delete Folder',
    description:
      "Delete a folder without orphaning contents. By default documents and sub-folders move to the deleted folder's parent (Unfiled when it was at the project root). Pass reparent_to null for Unfiled, or a folder id to move contents there.",
    inputSchema: deleteFolderInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { folder_id: string; reparent_to?: string | null }) =>
          services.folderService.delete(
            args.folder_id,
            args.reparent_to !== undefined ? { reparentTo: args.reparent_to } : undefined,
          ),
        'deleted',
        () => true,
      ),
  },
  {
    name: 'move_documents',
    title: 'Move Documents',
    description:
      'Move many documents into a folder in one call (or to Unfiled when folder_id is null). Not atomic: each document_id is attempted independently and the result lists `moved` ids plus per-item `failed` entries — a missing, foreign, or invalid id does not roll back the rest.',
    inputSchema: moveDocumentsInputSchema,
    handler: (services) => createMoveDocumentsHandler(services.documentService),
  },
  {
    name: 'create_prototype',
    title: 'Create Prototype',
    description:
      'Create a named prototype flow with a declared viewport. Viewport presets (guidance, not an enum): 390×844 phone, 1024×768 tablet, 1440×900 desktop — free values are allowed. Screens are HTML artifacts attached via create_artifact with prototype_id.',
    inputSchema: createPrototypeInputSchema,
    handler: (services) => createCreatePrototypeHandler(services.prototypeService),
  },
  {
    name: 'list_prototypes',
    title: 'List Prototypes',
    description: 'List prototypes for a project (id, name, viewport, timestamps).',
    inputSchema: listPrototypesInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ project_id }: { project_id: string }) => services.prototypeService.list(project_id),
        'prototypes',
      ),
  },
  {
    name: 'get_prototype',
    title: 'Get Prototype',
    description:
      'Get a prototype by id, including its screens (HTML artifacts with that prototype_id).',
    inputSchema: getPrototypeInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ prototype_id }: { prototype_id: string }) => services.prototypeService.get(prototype_id),
        'prototype',
      ),
  },
  {
    name: 'update_prototype',
    title: 'Update Prototype',
    description:
      'Rename a prototype or change its viewport. Viewport presets (guidance): 390×844 phone, 1024×768 tablet, 1440×900 desktop.',
    inputSchema: updatePrototypeInputSchema,
    handler: (services) => createUpdatePrototypeHandler(services.prototypeService),
  },
  {
    name: 'create_note',
    title: 'Create Note',
    description:
      'Create a free-form project note. Notes are working notes scoped to the project (findings, context, anything worth referring back to) — not formal documents. Write the body as well-structured Markdown; it is rendered as rich text.',
    inputSchema: createNoteInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { project_id: string; title: string; body?: string }) =>
          services.noteService.create(args.project_id, {
            title: args.title,
            ...(args.body !== undefined ? { body: args.body } : {}),
          }),
        'note',
      ),
  },
  {
    name: 'update_note',
    title: 'Update Note',
    description:
      'Update a project note title or body. Write the body as well-structured Markdown; it is rendered as rich text.',
    inputSchema: updateNoteInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { note_id: string; title?: string; body?: string }) =>
          services.noteService.update(args.note_id, {
            ...(args.title !== undefined ? { title: args.title } : {}),
            ...(args.body !== undefined ? { body: args.body } : {}),
          }),
        'note',
      ),
  },
  {
    name: 'get_note',
    title: 'Get Note',
    description: 'Get a project note by id',
    inputSchema: getNoteInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(({ note_id }: { note_id: string }) => services.noteService.get(note_id), 'note'),
  },
  {
    name: 'list_notes',
    title: 'List Notes',
    description: 'List the working notes for a project',
    inputSchema: listNotesInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createListNotesHandler(services.noteService),
  },
  {
    name: 'search',
    title: 'Search',
    description:
      'Search documents, tasks, and notes by title, label, or body text within the active workspace (or a single project). Returns ranked matches with excerpts for body hits.',
    inputSchema: searchInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createSearchHandler(services.searchService),
  },
  {
    name: 'create_artifact',
    title: 'Create Artifact',
    description:
      "Create an agent-produced deliverable (report, RFC, HTML diagram) stored in the workspace. Pass optional prototype_id (same project) with kind 'html' to attach it as a screen — markdown screens are refused. Do not send x/y; layout is system-owned. Humans can annotate via the CLI previewer; the returned artifact_id is exactly the id used by list_artifact_comments and add_artifact_comment.",
    inputSchema: createArtifactInputSchema,
    handler: (services, ctx) =>
      createCreateArtifactHandler(services.artifactService, ctx.filePathDeps),
  },
  {
    name: 'get_artifact',
    title: 'Get Artifact',
    description:
      'Get a stored artifact by id, including its full content. Use after list_artifact_comments to read human feedback before revising with update_artifact.',
    inputSchema: getArtifactInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ artifact_id }: { artifact_id: string }) => services.artifactService.get(artifact_id),
        'artifact',
      ),
  },
  {
    name: 'update_artifact',
    title: 'Update Artifact',
    description:
      'Revise a stored artifact (title, content, or kind). Use after reading artifact comments to incorporate human annotations. Screen x/y layout is system-owned — use move_screen or the canvas API instead of sending x or y.',
    inputSchema: updateArtifactInputSchema,
    handler: (services, ctx) =>
      createUpdateArtifactHandler(services.artifactService, ctx.filePathDeps),
  },
  {
    name: 'move_screen',
    title: 'Move Screen',
    description:
      'Move an html screen to another prototype in the same project. Keeps the artifact id and comments; re-resolves derived links in the destination. Does not rewrite markup.',
    inputSchema: moveScreenInputSchema,
    handler: (services) => createMoveScreenHandler(services.artifactService),
  },
  {
    name: 'copy_screen',
    title: 'Copy Screen',
    description:
      'Copy an html screen into another prototype. New artifact id, same content, comments do not travel. Title links resolve in the destination prototype.',
    inputSchema: copyScreenInputSchema,
    handler: (services) => createCopyScreenHandler(services.artifactService),
  },
  {
    name: 'list_artifacts',
    title: 'List Artifacts',
    description:
      'List artifact summaries for a project (id, title, kind, updated_at). Artifacts are agent deliverables humans annotate via the previewer.',
    inputSchema: listArtifactsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ project_id }: { project_id: string }) =>
          services.artifactService.listByProject(project_id),
        'artifacts',
      ),
  },
  {
    name: 'create_edge',
    title: 'Create Edge',
    description: `Create a directed edge between any two entities via from_type/from_id/to_type/to_id (entity types: ${LINK_ENTITY_TYPE_LIST}). Legacy from_task_id/to_task_id still accepted and map to type task. Prefer the label vocabulary: blocks, depends_on, unblocks, feeds, clarifies, enables, supports, documents, references, supersedes, extends.`,
    inputSchema: createEdgeInputSchema,
    outputSchema: createEdgeOutputSchema,
    handler: (services) => createCreateEdgeHandler(services.canvasService),
  },
  {
    name: 'list_edges',
    title: 'List Edges',
    description:
      'List edges for a project with typed endpoints (id, from_type, from_id, to_type, to_id, label). Use this to inspect the graph before pruning a stale edge with delete_edge — each edge `id` here is exactly the edge_id delete_edge takes.',
    inputSchema: listEdgesInputSchema,
    outputSchema: listEdgesOutputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ project_id }: { project_id: string }) => services.canvasService.listEdges(project_id),
        'edges',
      ),
  },
  {
    name: 'delete_edge',
    title: 'Delete Edge',
    description:
      "Remove one edge by id (the edge_id from a get_document links/backlinks entry or list_edges). Only the addressed edge is deleted; sibling edges on the same entity stay intact. Updates get_next_task's blocked/waiting_on computation immediately for task-graph edges.",
    inputSchema: deleteEdgeInputSchema,
    annotations: {
      destructiveHint: true,
      // Re-deleting an already-removed edge is a no-op (returns not_found);
      // no further data changes, so a retry is safe.
      idempotentHint: true,
    },
    handler: (services) =>
      serviceTool(
        ({ edge_id }: { edge_id: string }) => services.canvasService.deleteEdgeById(edge_id),
        'deleted',
        () => true,
      ),
  },
  {
    name: 'attach_file',
    title: 'Attach File',
    description:
      'Upload a file (image today) and get back a short URL. Embed the returned `url` in a task, document, or comment body as `![alt](url)` instead of inlining base64 — keeps bodies lean. mime defaults to image/png. On loopback, `file_path` reads from disk only when the path resolves under a project repo root registered in this workspace (`folder_path`); otherwise use `content_base64`.',
    inputSchema: attachFileInputSchema,
    handler: (services, ctx) => createAttachFileHandler(services.fileService, ctx.filePathDeps),
  },
  {
    name: 'create_share_link',
    title: 'Create Share Link',
    description:
      "Mint a public, hash-token share link scoped to a single task, document, or prototype, with a Markdown URL (`markdown_url`) a worker can `curl` for full context — put \"Context: <markdown_url>\" in a worker brief instead of pasting. Exactly one of task_id/document_id/prototype_id is required. expires defaults to 24h; never means the link does not expire. The result carries reachable_from: 'this_machine' means a loopback URL only the host running plandesk serve can open (paste the context instead for a remote worker); 'network' means it is built on PLANDESK_BASE_URL. The link is an unauthenticated bearer URL.",
    inputSchema: createShareLinkInputSchema,
    handler: (services, ctx) =>
      createCreateShareLinkHandler(services.shareService, () => ctx.origin),
  },
  {
    name: 'start_agent_run',
    title: 'Start Agent Run',
    description:
      'Begin an external agent session. Takes project_id and an optional label; returns { agent_run: { id } } — that id is the run_id for record_agent_progress and complete_agent_run.',
    inputSchema: startAgentRunInputSchema,
    handler: (services) =>
      serviceTool(
        ({ project_id, label }: { project_id: string; label?: string }) =>
          services.agentRunService.start(project_id, label),
        'agent_run',
      ),
  },
  {
    name: 'record_agent_progress',
    title: 'Record Agent Progress',
    description:
      'Append a progress event to an agent run. Takes run_id (from start_agent_run) and message (the progress text).',
    inputSchema: recordAgentProgressInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { run_id: string; message: string }) =>
          services.agentRunService.recordProgress(args.run_id, args.message),
        'event',
      ),
  },
  {
    name: 'complete_agent_run',
    title: 'Complete Agent Run',
    description:
      "Close an agent run. Takes run_id and status: 'completed' | 'failed'. There is no summary field — record the summary as a final record_agent_progress message first.",
    inputSchema: completeAgentRunInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { run_id: string; status: 'completed' | 'failed' }) =>
          services.agentRunService.complete(args.run_id, args.status),
        'agent_run',
      ),
  },
  {
    name: 'scaffold_project_from_plan',
    title: 'Scaffold Project From Plan',
    description:
      'Scaffold tasks, dependency edges, and linked documents in one atomic call — into a new project, or into an existing one when project_id is given (e.g. the repo-bound project). Each document may take link_to as a single plan key or a list of task/document keys (resolved via key_to_id); give documents a key to reference them from other documents.',
    inputSchema: scaffoldProjectFromPlanInputSchema,
    handler: (services) =>
      createScaffoldProjectFromPlanHandler(
        services.projectService,
        services.canvasService,
        services.documentService,
      ),
  },
  {
    name: 'create_goal',
    title: 'Create Goal',
    description:
      'Create a goal for a project with an optional short unique name, objective, and contract fields',
    inputSchema: createGoalInputSchema,
    handler: (services) => createCreateGoalHandler(services.goalService),
  },
  {
    name: 'get_goal',
    title: 'Get Goal',
    description: 'Get a goal by ID including its cycle-tasks',
    inputSchema: getGoalInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createGetGoalHandler(services.goalService),
  },
  {
    name: 'list_goals',
    title: 'List Goals',
    description: 'List all goals for a project',
    inputSchema: listGoalsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ project_id }: { project_id: string }) => services.goalService.listByProject(project_id),
        'goals',
      ),
  },
  {
    name: 'update_goal',
    title: 'Update Goal',
    description:
      "Edit an existing goal's name, objective, or contract fields (verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget). Does not detach the goal's cycle-tasks. Omit a field to leave it unchanged. Goal lifecycle status is not writable here — use pause_goal, resume_goal, or complete_goal instead.",
    inputSchema: updateGoalInputSchema,
    handler: (services) => createUpdateGoalHandler(services.goalService),
  },
  {
    name: 'set_current_goal',
    title: 'Set Current Goal',
    description:
      'Point the project current_goal_id at this active goal so get_next_task resolves here when goal_id is omitted.',
    inputSchema: setCurrentGoalInputSchema,
    handler: (services) =>
      serviceToolPayload(({ goal_id }: { goal_id: string }) =>
        services.goalService.setCurrent(goal_id),
      ),
  },
  {
    name: 'invoke_goal',
    title: 'Invoke Goal',
    description:
      'Begin working a goal: sets current_goal_id, checks the task graph for cycles, and returns the first frontier todo. Fails with no_todo_tasks when tasks are still in scope (release scope → todo explicitly — this tool does not self-release). Other active goals remain active; warnings explain how get_next_task resolves.',
    inputSchema: goalLifecycleInputSchema,
    handler: (services) => createInvokeGoalHandler(services.goalService),
  },
  {
    name: 'pause_goal',
    title: 'Pause Goal',
    description: 'Pause an active goal',
    inputSchema: goalLifecycleInputSchema,
    handler: (services) => createPauseGoalHandler(services.goalService),
  },
  {
    name: 'resume_goal',
    title: 'Resume Goal',
    description: 'Resume a paused goal',
    inputSchema: goalLifecycleInputSchema,
    handler: (services) => createResumeGoalHandler(services.goalService),
  },
  {
    name: 'complete_goal',
    title: 'Complete Goal',
    description:
      'Mark a goal complete when every cycle-task is done and verification evidence is green. Submit evidence matching the goal verification_surface; red evidence blocks the goal and files a remediation task.',
    inputSchema: completeGoalInputSchema,
    handler: (services) => createCompleteGoalHandler(services.goalService),
  },
  {
    name: 'get_next_task',
    title: 'Get Next Task',
    description:
      'Return the next actionable todo on the project active goal frontier (or a specific goal via goal_id or project-scoped goal name). When both are omitted: resolves via current_goal_id, then the sole active goal, then ambiguous_goal — never unions active goals; with no active goal it serves tasks that belong to no goal. Pass goal_id: null to serve the goal-less tasks explicitly. Optional tags filter uses OR semantics; prerequisite completion is evaluated against all project tasks. Does not claim — call claim_task on the candidate.',
    inputSchema: getNextTaskInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createGetNextTaskHandler(services.taskService),
  },
  {
    name: 'claim_task',
    title: 'Claim Task',
    description:
      'Atomically claim a todo task for an agent (status → in_progress, assignee = agent_ref). Exactly one concurrent claim wins; losers get claimed: false.',
    inputSchema: claimTaskInputSchema,
    handler: (services) =>
      serviceToolPayload(({ task_id, agent_ref }: { task_id: string; agent_ref: string }) =>
        services.taskService.claim(task_id, agent_ref),
      ),
  },
  {
    name: 'get_task_graph',
    title: 'Get Task Graph',
    description:
      'Return the task dependency graph with prerequisite fan-in, depth, roots, detected cycles, and the tasks actionable if every scope task were released. Optionally scope to one goal.',
    inputSchema: getTaskGraphInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceToolPayload(({ project_id, goal_id }: { project_id: string; goal_id?: string }) =>
        services.taskService.getTaskGraph(project_id, goal_id),
      ),
  },
  {
    name: 'get_task',
    title: 'Get Task',
    description: 'Get a single task by ID including its current status, label, and description',
    inputSchema: getTaskInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(({ task_id }: { task_id: string }) => services.taskService.get(task_id), 'task'),
  },
  {
    name: 'list_tasks',
    title: 'List Tasks',
    description:
      'List all tasks for a project, optionally filtered by status, typed lane/severity, and/or tags. The `tags` filter uses OR semantics: a task matches if it carries ANY of the given tag names. Use this to reconcile the board against reality. Returns summary fields by default; pass verbose: true to include descriptions.',
    inputSchema: listTasksInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createListTasksHandler(services.taskService),
  },
  {
    name: 'list_tags',
    title: 'List Tags',
    description: 'List the tags of a project (name, optional color) for labeling tasks',
    inputSchema: listTagsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ project_id }: { project_id: string }) => services.tagService.list(project_id),
        'tags',
      ),
  },
  {
    name: 'list_views',
    title: 'List Views',
    description:
      'List saved named views for a project (name + config). Views are human-authored named queries — agents consume them via this read-only tool; there is no create/update/delete view tool.',
    inputSchema: listViewsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        async ({ project_id }: { project_id: string }) =>
          (await services.viewService.list(project_id))?.map(({ id, name, config, position }) => ({
            id,
            name,
            config,
            position,
          })),
        'views',
      ),
  },
  {
    name: 'list_revisions',
    title: 'List Revisions',
    description:
      'List content-history metadata for a task or document (id, author, changed fields, timestamp). Newest first. Does not include snapshot bodies — use get_revision for those.',
    inputSchema: listRevisionsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        (args: { project_id: string; target_type: 'task' | 'document'; target_id: string }) =>
          services.revisionService.list(args.project_id, args.target_type, args.target_id),
        'revisions',
      ),
  },
  {
    name: 'get_revision',
    title: 'Get Revision',
    description:
      'Get one content-history revision including its full prior-state snapshot. Read-only — there is no restore tool over MCP.',
    inputSchema: getRevisionInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        ({ revision_id }: { revision_id: string }) => services.revisionService.get(revision_id),
        'revision',
      ),
  },
  {
    name: 'list_comments',
    title: 'List Comments',
    description:
      "List unresolved comments for a project; narrow to one item with target_type ('document' | 'task' | 'note' | 'submission') and target_id. Pass include_resolved: true for resolved ones too.",
    inputSchema: listCommentsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) => createListCommentsHandler(services.commentService),
  },
  {
    name: 'add_comment',
    title: 'Add Comment',
    description:
      "Leave a comment on one item, addressed by target_type ('document' | 'task' | 'note' | 'submission') and target_id — e.g. a gate decision on a task: { target_type: 'task', target_id: <task id>, body }. passage optionally anchors it to quoted text.",
    inputSchema: addCommentInputSchema,
    handler: (services) => createAddCommentHandler(services.commentService),
  },
  {
    name: 'list_artifact_comments',
    title: 'List Artifact Comments',
    description: 'List annotations on a file artifact for a project.',
    inputSchema: listArtifactCommentsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        (args: { project_id: string; artifact_id: string; include_resolved?: boolean }) =>
          services.commentService.listForArtifact(args.project_id, args.artifact_id, {
            includeResolved: args.include_resolved ?? false,
          }),
        'comments',
      ),
  },
  {
    name: 'add_artifact_comment',
    title: 'Add Artifact Comment',
    description:
      'Create an annotation on a file artifact (previewed via `plandesk <file>`). artifact_id is the file identity; anchor is the W3C selector JSON.',
    inputSchema: addArtifactCommentInputSchema,
    handler: (services) => createAddArtifactCommentHandler(services.commentService),
  },
  {
    name: 'resolve_comment',
    title: 'Resolve Comment',
    description: 'Mark document feedback as addressed',
    inputSchema: resolveCommentInputSchema,
    handler: (services) =>
      serviceTool(
        (args: { comment_id: string }) =>
          services.commentService.update(args.comment_id, { resolved: true }),
        'comment',
      ),
  },
  {
    name: 'check_references',
    title: 'Check References',
    description:
      'Report documents whose source_path does not exist under the project folder_path. Read-only — never edits board data. Returns unknown: true when the server cannot access the repo: hosted Workers, a server bound to a non-loopback address (a disk probe there would let any member test for files on the host), or no folder_path.',
    inputSchema: checkReferencesInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceToolPayload((args: { project_id: string }) =>
        services.referenceCheckService.check(args.project_id),
      ),
  },
  {
    name: 'list_submissions',
    title: 'List Submissions',
    description: 'List pulled participant submissions for triage',
    inputSchema: listSubmissionsInputSchema,
    annotations: { readOnlyHint: true },
    handler: (services) =>
      serviceTool(
        async (args: { project_id: string; status?: ShareSubmissionStatus }) =>
          (await services.projectService.get(args.project_id)) === undefined
            ? undefined
            : services.syncService.listTriage(args.project_id, args.status),
        'submissions',
      ),
  },
  {
    name: 'triage_submission',
    title: 'Triage Submission',
    description: 'Accept or reject a participant submission',
    inputSchema: triageSubmissionInputSchema,
    handler: (services) => createTriageSubmissionHandler(services.syncService),
  },
];

/**
 * Every registered tool. A service validation error (`InvalidArgumentError`)
 * becomes an `invalid_argument` result here, once — the server and the
 * isolation audits both call these handlers, so no tool catches its own.
 */
export const TOOLS: McpToolDefinition[] = DEFINITIONS.map((tool) => ({
  ...tool,
  handler: (services, ctx) => {
    const handle = tool.handler(services, ctx) as (...args: unknown[]) => Promise<ToolResult>;
    return async (...args: unknown[]) => {
      try {
        return await handle(...args);
      } catch (error) {
        if (error instanceof InvalidArgumentError) {
          return toolInvalidArgument(error.message);
        }
        throw error;
      }
    };
  },
}));
