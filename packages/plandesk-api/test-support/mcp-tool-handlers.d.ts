/**
 * Loose type shim for the MCP tool-handler factories.
 *
 * WHY THIS FILE EXISTS
 * The workspace-isolation audit suites (workspace-isolation-audit3/4.test.ts) drive
 * the REAL MCP handler factories to verify tenant/workspace isolation. Importing the
 * MCP sources directly across the package boundary is TS6059 under this package's
 * `rootDir: "src"`, so the runtime bindings live in `mcp-tool-handlers.js` (relative
 * re-exports of the MCP source) and this hand-written `.d.ts` types them — keeping the
 * MCP program out of the api tsc program.
 *
 * WHY THE SIGNATURES ARE LOOSE
 * Every handler is declared as `(dep?: unknown, ...) => (args?: Record<string, unknown>) => Promise<McpToolResult>`.
 * This is deliberate, not laziness: the audit suites call multi-dependency factories with
 * only the FIRST dependency (e.g. `createCreateDocumentHandler(s.documentService)`) to
 * exercise the isolation-rejection path, so the dependency params MUST stay permissive.
 * Precise arg shapes would be possible but are intentionally not asserted here.
 *
 * WHAT CATCHES A DRIFT (AND WHEN) — measured, not assumed
 *   change to an MCP handler            `api tsc` (this file)     audit suite (runtime)
 *   rename exported factory             exit 0 — NOT caught       FAILS (TypeError)
 *   rename a handler argument           exit 0 — NOT caught       FAILS
 * So compile-time checking of handler signatures does NOT fire here; the runtime audit
 * suite is the net. This is a feedback-loop cost (a break surfaces at suite time, not
 * type-check time), NOT an isolation hole: the audits assert positive behaviour too, so
 * a broken handler call fails them rather than passing vacuously.
 *
 * WHY GENERATION WAS REJECTED (measured)
 * The intended "cheap fix" was to generate this `.d.ts` from the MCP sources so the
 * declared signatures stay honest at compile time. Measured blockers, each verified:
 *   1. `@plandesk/mcp` is NOT a dependency of `@plandesk/api` and is not resolvable from
 *      this package (not in node_modules at any level; no tsconfig `paths`). Re-exporting
 *      the handler types by package name is therefore impossible without adding the
 *      dependency, and the api↔mcp boundary stays type-only by design.
 *   2. Re-exporting from the MCP built `dist/*.d.ts` via relative path avoids TS6059, but
 *      those declarations import their dependency types from `@plandesk/api`, which is not
 *      self-resolvable from within the api program. Under `skipLibCheck` the unresolved
 *      import collapses each handler signature to `any` — so the re-export catches a
 *      factory rename but NOT an argument rename (only half the goal), and spreads `any`.
 *   3. A self-contained generated `.d.ts` (service types imported from the api's own
 *      barrel, `ToolResult` inlined, per-handler arg shapes precise) DOES yield precise
 *      types and catches both renames — verified with a probe. But keeping it honest
 *      requires regenerating it whenever an MCP handler changes, i.e. a build/prepare
 *      hook. Adding that hook means editing `package.json`, which this run is constrained
 *      from doing. Without the hook the file drifts on the very changes it is meant to
 *      guard — a fragile codegen step, exactly the outcome the brief says to avoid.
 *
 * Net: the loose shim plus the runtime audit net is the accepted trade. To upgrade to
 * compile-time enforcement later, add `@plandesk/mcp` as an api (dev)dependency and emit
 * these declarations from source as a build step; the boundary is otherwise unchanged.
 *
 * Runtime lives in mcp-tool-handlers.js — do not edit these names without editing both.
 */

/** Loose result shape — matches the MCP ToolResult structurally. */
export type McpToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type McpToolHandler = (args?: Record<string, unknown>) => Promise<McpToolResult>;

export declare function createAddArtifactCommentHandler(
  dep?: unknown,
  dep2?: unknown,
): McpToolHandler;
export declare function createAddCommentHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createAttachFileHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createClaimTaskHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCompleteAgentRunHandler(
  dep?: unknown,
  dep2?: unknown,
): McpToolHandler;
export declare function createCompleteGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateArtifactHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateDocumentHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateEdgeHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateFolderHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreatePrototypeHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateNoteHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateProjectHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateShareLinkHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCreateTaskHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createDeleteEdgeHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetArtifactHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetDocumentHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetNextTaskHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetTaskGraphHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetNoteHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetPrototypeHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetProjectHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetTaskHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListArtifactCommentsHandler(
  dep?: unknown,
  dep2?: unknown,
): McpToolHandler;
export declare function createListArtifactsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListCommentsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListDocumentsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListEdgesHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListGoalsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListNotesHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createSearchHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListPrototypesHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListProjectsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListSubmissionsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListTagsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListViewsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListRevisionsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createGetRevisionHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createListTasksHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createPauseGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createRecordAgentProgressHandler(
  dep?: unknown,
  dep2?: unknown,
): McpToolHandler;
export declare function createResolveCommentHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createResumeGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createScaffoldProjectFromPlanHandler(
  dep?: unknown,
  dep2?: unknown,
): McpToolHandler;
export declare function createStartAgentRunHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createSyncPullHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createTriageSubmissionHandler(
  dep?: unknown,
  dep2?: unknown,
): McpToolHandler;
export declare function createUpdateArtifactHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createMoveScreenHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createCopyScreenHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdateDocumentHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdateFolderHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createDeleteFolderHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createMoveDocumentsHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdatePrototypeHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdateGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createSetCurrentGoalHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdateNoteHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdateProjectHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
export declare function createUpdateTaskHandler(dep?: unknown, dep2?: unknown): McpToolHandler;
