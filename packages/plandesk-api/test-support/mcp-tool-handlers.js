// Runtime re-exports of MCP tool handlers for API isolation audit tests.
// Typed via mcp-tool-handlers.d.ts so `tsc -p tsconfig.json` does not pull
// MCP sources into the api rootDir program (TS6059).

import { TOOLS } from '../../plandesk-mcp/src/tools/table.js';

export { createAddArtifactCommentHandler } from '../../plandesk-mcp/src/tools/add-artifact-comment.js';
export { createAddCommentHandler } from '../../plandesk-mcp/src/tools/add-comment.js';
export { createAttachFileHandler } from '../../plandesk-mcp/src/tools/attach-file.js';
export { createCreateArtifactHandler } from '../../plandesk-mcp/src/tools/create-artifact.js';
export { createCreateDocumentHandler } from '../../plandesk-mcp/src/tools/create-document.js';
export { createCreateEdgeHandler } from '../../plandesk-mcp/src/tools/create-edge.js';
export { createCreatePrototypeHandler } from '../../plandesk-mcp/src/tools/create-prototype.js';
export { createCreateGoalHandler } from '../../plandesk-mcp/src/tools/create-goal.js';
export { createCreateProjectHandler } from '../../plandesk-mcp/src/tools/create-project.js';
export { createUpdateProjectHandler } from '../../plandesk-mcp/src/tools/update-project.js';
export { createCreateShareLinkHandler } from '../../plandesk-mcp/src/tools/create-share-link.js';
export { createCreateTaskHandler } from '../../plandesk-mcp/src/tools/create-task.js';
export { createGetGoalHandler } from '../../plandesk-mcp/src/tools/get-goal.js';
export { createGetNextTaskHandler } from '../../plandesk-mcp/src/tools/get-next-task.js';
export {
  createCompleteGoalHandler,
  createPauseGoalHandler,
  createResumeGoalHandler,
} from '../../plandesk-mcp/src/tools/goal-lifecycle.js';
export { createListCommentsHandler } from '../../plandesk-mcp/src/tools/list-comments.js';
export { createListDocumentsHandler } from '../../plandesk-mcp/src/tools/list-documents.js';
export { createListNotesHandler } from '../../plandesk-mcp/src/tools/list-notes.js';
export { createSearchHandler } from '../../plandesk-mcp/src/tools/search.js';
export { createListTasksHandler } from '../../plandesk-mcp/src/tools/list-tasks.js';
export { createScaffoldProjectFromPlanHandler } from '../../plandesk-mcp/src/tools/scaffold-project-from-plan.js';
export { createTriageSubmissionHandler } from '../../plandesk-mcp/src/tools/triage-submission.js';
export { createUpdateArtifactHandler } from '../../plandesk-mcp/src/tools/update-artifact.js';
export {
  createMoveScreenHandler,
  createCopyScreenHandler,
} from '../../plandesk-mcp/src/tools/move-copy-screen.js';
export { createUpdateDocumentHandler } from '../../plandesk-mcp/src/tools/update-document.js';
export { createMoveDocumentsHandler } from '../../plandesk-mcp/src/tools/move-documents.js';
export { createUpdatePrototypeHandler } from '../../plandesk-mcp/src/tools/update-prototype.js';
export { createUpdateGoalHandler } from '../../plandesk-mcp/src/tools/update-goal.js';
export { createInvokeGoalHandler } from '../../plandesk-mcp/src/tools/invoke-goal.js';
export { createUpdateTaskHandler } from '../../plandesk-mcp/src/tools/update-task.js';

/**
 * The handler the MCP server actually registers for `name`, built from the one
 * TOOLS table — so the audits exercise the real wiring, never a copy of it.
 */
export function toolHandler(name, services, ctx = {}) {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (tool === undefined) {
    throw new Error(`no MCP tool named ${name}`);
  }
  return tool.handler(services, {
    origin: 'http://127.0.0.1:7526',
    filePathDeps: { bindHost: '127.0.0.1', workspaceRoots: () => [] },
    ...ctx,
  });
}
