// Runtime re-exports of MCP tool handlers for API isolation audit tests.
// Typed via mcp-tool-handlers.d.ts so `tsc -p tsconfig.json` does not pull
// MCP sources into the api rootDir program (TS6059).

export { createAddArtifactCommentHandler } from '../../plandesk-mcp/src/tools/add-artifact-comment.js';
export { createAddCommentHandler } from '../../plandesk-mcp/src/tools/add-comment.js';
export { createAttachFileHandler } from '../../plandesk-mcp/src/tools/attach-file.js';
export { createClaimTaskHandler } from '../../plandesk-mcp/src/tools/claim-task.js';
export { createCompleteAgentRunHandler } from '../../plandesk-mcp/src/tools/complete-agent-run.js';
export { createCreateArtifactHandler } from '../../plandesk-mcp/src/tools/create-artifact.js';
export { createCreateDocumentHandler } from '../../plandesk-mcp/src/tools/create-document.js';
export { createCreateEdgeHandler } from '../../plandesk-mcp/src/tools/create-edge.js';
export { createCreateFolderHandler } from '../../plandesk-mcp/src/tools/create-folder.js';
export { createCreatePrototypeHandler } from '../../plandesk-mcp/src/tools/create-prototype.js';
export { createCreateGoalHandler } from '../../plandesk-mcp/src/tools/create-goal.js';
export { createCreateNoteHandler } from '../../plandesk-mcp/src/tools/create-note.js';
export { createCreateProjectHandler } from '../../plandesk-mcp/src/tools/create-project.js';
export { createUpdateProjectHandler } from '../../plandesk-mcp/src/tools/update-project.js';
export { createCreateShareLinkHandler } from '../../plandesk-mcp/src/tools/create-share-link.js';
export { createCreateTaskHandler } from '../../plandesk-mcp/src/tools/create-task.js';
export { createDeleteEdgeHandler } from '../../plandesk-mcp/src/tools/delete-edge.js';
export { createGetArtifactHandler } from '../../plandesk-mcp/src/tools/get-artifact.js';
export { createGetDocumentHandler } from '../../plandesk-mcp/src/tools/get-document.js';
export { createGetGoalHandler } from '../../plandesk-mcp/src/tools/get-goal.js';
export { createGetNextTaskHandler } from '../../plandesk-mcp/src/tools/get-next-task.js';
export { createGetTaskGraphHandler } from '../../plandesk-mcp/src/tools/get-task-graph.js';
export { createGetNoteHandler } from '../../plandesk-mcp/src/tools/get-note.js';
export { createGetPrototypeHandler } from '../../plandesk-mcp/src/tools/get-prototype.js';
export { createGetProjectHandler } from '../../plandesk-mcp/src/tools/get-project.js';
export { createGetTaskHandler } from '../../plandesk-mcp/src/tools/get-task.js';
export {
  createCompleteGoalHandler,
  createPauseGoalHandler,
  createResumeGoalHandler,
} from '../../plandesk-mcp/src/tools/goal-lifecycle.js';
export { createListArtifactCommentsHandler } from '../../plandesk-mcp/src/tools/list-artifact-comments.js';
export { createListArtifactsHandler } from '../../plandesk-mcp/src/tools/list-artifacts.js';
export { createListCommentsHandler } from '../../plandesk-mcp/src/tools/list-comments.js';
export { createListDocumentsHandler } from '../../plandesk-mcp/src/tools/list-documents.js';
export { createListEdgesHandler } from '../../plandesk-mcp/src/tools/list-edges.js';
export { createListGoalsHandler } from '../../plandesk-mcp/src/tools/list-goals.js';
export { createListNotesHandler } from '../../plandesk-mcp/src/tools/list-notes.js';
export { createSearchHandler } from '../../plandesk-mcp/src/tools/search.js';
export { createListPrototypesHandler } from '../../plandesk-mcp/src/tools/list-prototypes.js';
export { createListProjectsHandler } from '../../plandesk-mcp/src/tools/list-projects.js';
export { createListSubmissionsHandler } from '../../plandesk-mcp/src/tools/list-submissions.js';
export { createListTagsHandler } from '../../plandesk-mcp/src/tools/list-tags.js';
export { createListViewsHandler } from '../../plandesk-mcp/src/tools/list-views.js';
export { createListRevisionsHandler } from '../../plandesk-mcp/src/tools/list-revisions.js';
export { createGetRevisionHandler } from '../../plandesk-mcp/src/tools/get-revision.js';
export { createListTasksHandler } from '../../plandesk-mcp/src/tools/list-tasks.js';
export { createRecordAgentProgressHandler } from '../../plandesk-mcp/src/tools/record-agent-progress.js';
export { createResolveCommentHandler } from '../../plandesk-mcp/src/tools/resolve-comment.js';
export { createScaffoldProjectFromPlanHandler } from '../../plandesk-mcp/src/tools/scaffold-project-from-plan.js';
export { createStartAgentRunHandler } from '../../plandesk-mcp/src/tools/start-agent-run.js';
export { createSyncPullHandler } from '../../plandesk-mcp/src/tools/sync-pull.js';
export { createTriageSubmissionHandler } from '../../plandesk-mcp/src/tools/triage-submission.js';
export { createUpdateArtifactHandler } from '../../plandesk-mcp/src/tools/update-artifact.js';
export {
  createMoveScreenHandler,
  createCopyScreenHandler,
} from '../../plandesk-mcp/src/tools/move-copy-screen.js';
export { createUpdateDocumentHandler } from '../../plandesk-mcp/src/tools/update-document.js';
export { createUpdateFolderHandler } from '../../plandesk-mcp/src/tools/update-folder.js';
export { createDeleteFolderHandler } from '../../plandesk-mcp/src/tools/delete-folder.js';
export { createMoveDocumentsHandler } from '../../plandesk-mcp/src/tools/move-documents.js';
export { createUpdatePrototypeHandler } from '../../plandesk-mcp/src/tools/update-prototype.js';
export { createUpdateGoalHandler } from '../../plandesk-mcp/src/tools/update-goal.js';
export { createUpdateNoteHandler } from '../../plandesk-mcp/src/tools/update-note.js';
export { createUpdateTaskHandler } from '../../plandesk-mcp/src/tools/update-task.js';
