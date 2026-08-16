import { z } from 'zod';
import {
  artifactKinds,
  goalStatuses,
  isValidCommitRef,
  isValidFolderPath,
  isValidRepoUrl,
  linkEntityTypes,
  MAX_COMMIT_REFS,
  shareSubmissionStatuses,
  taskKinds,
  taskLanes,
  taskPriorities,
  taskSeverities,
  taskStatuses,
} from '@plandesk/db';

const repoUrlSchema = z
  .string()
  .refine(isValidRepoUrl, { message: 'invalid repo_url' })
  .nullable()
  .optional();

const folderPathSchema = z
  .string()
  .refine(isValidFolderPath, { message: 'invalid folder_path' })
  .nullable()
  .optional();

const DOCUMENT_BODY_DESCRIPTION =
  'Document body in Markdown (rendered as rich text). Structure it well: `##` headings, bullet lists, fenced code blocks, and blank lines between paragraphs. HTML is also accepted.';

const NOTE_BODY_DESCRIPTION =
  'Note body in Markdown (rendered as rich text). Notes are free-form working notes scoped to the project — use them for findings, context, or anything worth referring back to. HTML is also accepted.';

// Caller-terms: what the caller gets (an outgoing link), not how storage keeps it.
// The link_to field is the sole link input now; the legacy linked_task_id dual-write
// was dropped by the one-link-shape contract, so there is no precedence to state.
const LINK_TO_DESCRIPTION =
  "Task or document id(s) this document should link to. Accepts a single id or a list; each adds an outgoing link from this document (label 'documents' for a task target, 'references' for a document target). Read these links back — each carries its own edge_id — via get_document.";

// Derived, never restated. A local copy read 'task' | 'document' while the
// writer produced artifact and prototype endpoints too, so one prototype screen
// made list_edges and get_document fail output validation for a whole project.
const LINK_ENTITY_TYPE = z.enum(linkEntityTypes);

const LINK_ENTITY_TYPE_LIST = linkEntityTypes.map((type) => `'${type}'`).join(', ');

const TAGS_SET_DESCRIPTION =
  'Tag names to set on the task. Replaces the FULL tag set; tags that do not exist yet in the project are auto-created by name. Pass [] to remove all tags.';

const COMMIT_REFS_DESCRIPTION =
  'Hex commit SHAs (7–40 chars, case-insensitive; stored lowercase) that shipped this task. At most 50. Replaces the FULL array; pass null to clear. Omit to leave unchanged. Not accepted on create_task — a task has no commit at creation.';

const TAGS_FILTER_DESCRIPTION =
  'Optional tag-name filter with OR semantics: a task matches if it carries ANY of the given tags.';

const VERBOSE_DESCRIPTION =
  'When true, includes large body/description fields. Defaults to false so list reads are cheap and bounded.';

const TASK_DESCRIPTION_GUIDANCE =
  "Non-trivial tasks need build-contract depth (see .plandesk/skill.md's Task creation conventions): Problem, Action Items, Interfaces (concrete signatures/types/API/CLI this task touches, named exactly), Pseudocode (control flow for anything non-obvious), Validation contract (the test/command/observable outcome that proves it done), and References. No internal RFC/PRD/ticket references embedded in the text — the task must be executable without re-reading a parent doc.";

export const listProjectsInputSchema = z.object({});

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  workspace_id: z
    .string()
    .optional()
    .describe(
      'Workspace to create the project in. Omit to use the workspace this repo is bound to (sent as the x-plandesk-workspace-id header by `plandesk connect`); if there is none, the org default workspace is used.',
    ),
  owner_id: z.string().min(1).nullable().optional(),
  overview_document_id: z.string().uuid().nullable().optional(),
  repo_url: repoUrlSchema,
  folder_path: folderPathSchema,
});

export const updateProjectInputSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  owner_id: z.string().min(1).nullable().optional(),
  overview_document_id: z.string().uuid().nullable().optional(),
  repo_url: repoUrlSchema,
  folder_path: folderPathSchema,
});

export const getProjectInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const createTaskInputSchema = z.object({
  project_id: z.string().uuid(),
  label: z.string().min(1),
  status: z.enum(taskStatuses).optional(),
  kind: z.enum(taskKinds).optional(),
  priority: z.enum(taskPriorities).nullable().optional(),
  lane: z.enum(taskLanes).nullable().optional(),
  severity: z.enum(taskSeverities).nullable().optional(),
  description: z.string().optional().describe(TASK_DESCRIPTION_GUIDANCE),
  x: z.number().optional(),
  y: z.number().optional(),
  assignee: z.string().min(1).nullable().optional(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Goal this task belongs to (a cycle within the goal). Omit to attach to the project default goal.',
    ),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_SET_DESCRIPTION),
});

export const updateTaskInputSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(taskStatuses).optional(),
  kind: z.enum(taskKinds).optional(),
  priority: z.enum(taskPriorities).nullable().optional(),
  lane: z.enum(taskLanes).nullable().optional(),
  severity: z.enum(taskSeverities).nullable().optional(),
  label: z.string().optional(),
  description: z.string().optional().describe(TASK_DESCRIPTION_GUIDANCE),
  x: z.number().optional(),
  y: z.number().optional(),
  assignee: z.string().min(1).nullable().optional(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Reassign the task to a different goal in the same project. Omit to leave it unchanged.',
    ),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_SET_DESCRIPTION),
  commit_refs: z
    .array(z.string().refine(isValidCommitRef, { message: 'invalid commit_ref' }))
    .max(MAX_COMMIT_REFS)
    .nullable()
    .optional()
    .describe(COMMIT_REFS_DESCRIPTION),
});

export const createDocumentInputSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  link_to: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .describe(LINK_TO_DESCRIPTION),
  parent_id: z.string().uuid().optional(),
  folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Folder to place the document in on create. Omit for Unfiled (project root).'),
});

export const updateDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
  title: z.string().optional(),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  status_line: z.string().optional(),
  link_to: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .describe(LINK_TO_DESCRIPTION),
  folder_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'Move the document into a folder (MCP equivalent of dragging onto a folder). Pass null to move it to Unfiled at the project root.',
    ),
});

export const getDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
});

export const listDocumentsInputSchema = z.object({
  project_id: z.string().uuid(),
  folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Only list documents inside this folder. Omit for the full folder tree.'),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const createFolderInputSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1),
  parent_folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Parent folder for nesting. Omit to create the folder at the project root.'),
});

export const updateFolderInputSchema = z.object({
  folder_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  parent_folder_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'Re-parent the folder. Pass null to move it to the project root. Re-parenting that would create a cycle is rejected.',
    ),
});

export const deleteFolderInputSchema = z.object({
  folder_id: z.string().uuid(),
  reparent_to: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      "Where documents and sub-folders go. Omit to use the deleted folder's parent (Unfiled when it was at the project root). Pass null for Unfiled. Pass a folder id to move contents there. Never orphans or deletes contents.",
    ),
});

export const moveDocumentsInputSchema = z.object({
  document_ids: z
    .array(z.string().uuid())
    .min(1)
    .describe('Documents to move. Each id is attempted independently (not atomic).'),
  folder_id: z
    .string()
    .uuid()
    .nullable()
    .describe(
      'Destination folder, or null for Unfiled. Per-item results: missing/foreign/invalid ids appear in `failed` without rolling back successful moves.',
    ),
});

export const createNoteInputSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional().describe(NOTE_BODY_DESCRIPTION),
});

export const updateNoteInputSchema = z.object({
  note_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  body: z.string().optional().describe(NOTE_BODY_DESCRIPTION),
});

export const getNoteInputSchema = z.object({
  note_id: z.string().uuid(),
});

export const listNotesInputSchema = z.object({
  project_id: z.string().uuid(),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const createShareLinkInputSchema = z.object({
  task_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  prototype_id: z.string().uuid().optional(),
  expires: z
    .enum(['24h', '7d', 'never'])
    .optional()
    .describe('Link TTL. Defaults to 24h; never means the link does not expire.'),
});

const ARTIFACT_CONTENT_DESCRIPTION =
  'Artifact body. Markdown or HTML depending on kind — a report, RFC, or diagram a human can review with the CLI previewer.';

const PROTOTYPE_VIEWPORT_DESCRIPTION =
  'Viewport size in CSS pixels. Presets (guidance, not an enum): 390×844 phone, 1024×768 tablet, 1440×900 desktop. Free values are allowed.';

export const createPrototypeInputSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1),
  viewport_width: z.number().positive().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
  viewport_height: z.number().positive().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
});

export const listPrototypesInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const getPrototypeInputSchema = z.object({
  prototype_id: z.string().uuid(),
});

export const updatePrototypeInputSchema = z.object({
  prototype_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  viewport_width: z.number().positive().optional().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
  viewport_height: z.number().positive().optional().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
});

export const createArtifactInputSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  content: z
    .string()
    .optional()
    .describe(`${ARTIFACT_CONTENT_DESCRIPTION} Exactly one of content and file_path is required.`),
  file_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute or project-relative path to read content from. Loopback servers only — remote servers refuse with a stated error. Path must resolve under a project repo root registered in this workspace; otherwise use content. Mutually exclusive with content.',
    ),
  kind: z.enum(artifactKinds).optional().describe('Defaults to markdown.'),
  prototype_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Attach this artifact as a screen on a prototype. Requires kind 'html'. Must belong to the same project.",
    ),
});

export const getArtifactInputSchema = z.object({
  artifact_id: z.string().uuid(),
});

export const moveScreenInputSchema = z.object({
  artifact_id: z.string().uuid(),
  prototype_id: z.string().uuid().describe('Destination prototype in the same project.'),
});

export const copyScreenInputSchema = z.object({
  artifact_id: z.string().uuid(),
  prototype_id: z.string().uuid().describe('Destination prototype in the same project.'),
});

export const updateArtifactInputSchema = z.object({
  artifact_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  content: z
    .string()
    .optional()
    .describe(`${ARTIFACT_CONTENT_DESCRIPTION} Mutually exclusive with file_path.`),
  file_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute or project-relative path to read content from. Loopback servers only. Path must resolve under a project repo root registered in this workspace; otherwise use content. Mutually exclusive with content.',
    ),
  kind: z.enum(artifactKinds).optional(),
  prototype_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      "Set or clear the parent prototype. Requires kind 'html' when set. Must belong to the same project. Do not send x/y — layout is system-owned.",
    ),
});

export const listArtifactsInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const attachFileInputSchema = z.object({
  project_id: z.string().uuid(),
  filename: z
    .string()
    .min(1)
    .optional()
    .describe('Required with content_base64; defaults from file_path basename when omitted.'),
  content_base64: z
    .string()
    .min(1)
    .optional()
    .describe('Inline bytes. Exactly one of content_base64 and file_path is required.'),
  file_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute or project-relative path to read. Loopback servers only — remote servers refuse with a stated error. Path must resolve under a project repo root registered in this workspace; otherwise use content_base64. Mutually exclusive with content_base64.',
    ),
  mime: z
    .string()
    .min(1)
    .optional()
    .describe('Defaults to image/png or a guess from the filename.'),
});

export const createEdgeInputSchema = z.object({
  project_id: z.string().uuid(),
  from_type: LINK_ENTITY_TYPE.optional().describe(
    `Entity type of the edge's from endpoint: ${LINK_ENTITY_TYPE_LIST}. Required with from_id for typed edges.`,
  ),
  from_id: z
    .string()
    .uuid()
    .optional()
    .describe('Id of the from endpoint. Required with from_type for typed edges.'),
  to_type: LINK_ENTITY_TYPE.optional().describe(
    `Entity type of the edge's to endpoint: ${LINK_ENTITY_TYPE_LIST}. Required with to_id for typed edges.`,
  ),
  to_id: z
    .string()
    .uuid()
    .optional()
    .describe('Id of the to endpoint. Required with to_type for typed edges.'),
  from_task_id: z
    .string()
    .uuid()
    .optional()
    .describe('Legacy task-shaped from. Still accepted; maps to from_type=task, from_id=<value>.'),
  to_task_id: z
    .string()
    .uuid()
    .optional()
    .describe('Legacy task-shaped to. Still accepted; maps to to_type=task, to_id=<value>.'),
  label: z.string().optional(),
  style: z.string().optional(),
});

export const listEdgesInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const deleteEdgeInputSchema = z.object({
  edge_id: z
    .string()
    .uuid()
    .describe(
      'Id of the edge to remove. Obtain it from the `edge_id` field on a get_document links or backlinks entry, or from list_edges. Only this edge is affected; sibling edges on the same entity are left intact.',
    ),
});

// ---- outputSchema shapes ----
// Raw shapes (object of zod fields) passed to McpServer.registerTool's
// `outputSchema`. The SDK validates the handler's structuredContent against
// these, so they MUST match serializeDocument / serializeEdge exactly.
// Ids are randomUUID(); label/arrow_direction/style are nullable text columns.

const entityLinkOutputShape = {
  type: LINK_ENTITY_TYPE,
  id: z.string().uuid(),
  title: z.string(),
  label: z.string().nullable(),
  edge_id: z.string().uuid(),
};

const documentOutputShape = {
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string(),
  body: z.string().nullable(),
  status_line: z.string().nullable(),
  parent_id: z.string().uuid().nullable(),
  folder_id: z.string().uuid().nullable(),
  links: z.array(z.object(entityLinkOutputShape)),
  backlinks: z.array(z.object(entityLinkOutputShape)),
  created_at: z.string(),
  updated_at: z.string(),
};

const edgeOutputShape = {
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  from_type: LINK_ENTITY_TYPE,
  from_id: z.string().uuid(),
  to_type: LINK_ENTITY_TYPE,
  to_id: z.string().uuid(),
  label: z.string().nullable(),
  arrow_direction: z.string().nullable(),
  style: z.string().nullable(),
  created_at: z.string(),
};

export const getDocumentOutputSchema = { document: z.object(documentOutputShape) };
export const listEdgesOutputSchema = { edges: z.array(z.object(edgeOutputShape)) };
export const createEdgeOutputSchema = { edge: z.object(edgeOutputShape) };

export const startAgentRunInputSchema = z.object({
  project_id: z.string().uuid(),
  label: z.string().optional(),
});

export const recordAgentProgressInputSchema = z.object({
  run_id: z.string().uuid(),
  message: z.string().min(1),
});

export const completeAgentRunInputSchema = z.object({
  run_id: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
});

export const scaffoldProjectFromPlanInputSchema = z.object({
  workspace_id: z
    .string()
    .optional()
    .describe(
      'Workspace to create the project in. Omit to use the workspace this repo is bound to (sent as the x-plandesk-workspace-id header by `plandesk connect`); if there is none, the org default workspace is used.',
    ),
  project_id: z
    .string()
    .optional()
    .describe(
      'Scaffold the whole plan atomically INTO an existing project (e.g. the repo-bound one) instead of creating a new one. Omit to create a new project. When set, `name`/`description` are ignored and the plan is added to that project; new auto-laid-out tasks are placed below its existing nodes.',
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Name for a NEW project. Required when `project_id` is omitted; ignored when it is set.',
    ),
  description: z.string().optional(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Goal to attach scaffolded tasks to. Must belong to the target project (new or existing). Omit to use the project default goal.',
    ),
  tasks: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        status: z.enum(taskStatuses).optional(),
        description: z.string().optional().describe(TASK_DESCRIPTION_GUIDANCE),
        goal_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Goal for this task. Overrides the call-level goal_id when both are set. Must belong to the target project.',
          ),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
    )
    .min(1),
  edges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        label: z.string().optional(),
        style: z.string().optional(),
      }),
    )
    .optional(),
  documents: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Stable key for this document so other documents can link_to it in the same plan. Resolved into key_to_id alongside task keys.',
          ),
        title: z.string().min(1),
        body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
        status_line: z.string().optional(),
        link_to: z
          .union([z.string().min(1), z.array(z.string().min(1))])
          .optional()
          .describe(
            'Task or document plan key(s) to link. Accepts a single key or a list; resolved through key_to_id. A single string remains accepted for backward compatibility.',
          ),
      }),
    )
    .optional(),
});

const verificationEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('gate_command'),
    exit_code: z.number(),
    command: z.string().optional(),
    detail: z.string().optional(),
  }),
  z.object({
    kind: z.literal('acceptance_checklist'),
    checked: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('human_sign_off'),
    approved_by: z.string(),
  }),
]);

export const createGoalInputSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).nullable().optional(),
  objective: z.string().min(1),
  verification_surface: z
    .string()
    .optional()
    .describe(
      'JSON verification surface. A `kind` field is REQUIRED; use exactly one of: ' +
        '{"kind":"gate_command","command":"pnpm test"} | ' +
        '{"kind":"acceptance_checklist","items":[{"criterion":"..."}]} (the server returns stable item ids) | ' +
        '{"kind":"human_sign_off"}. ' +
        'complete_goal later takes matching evidence: {"kind":"gate_command","exit_code":0} | ' +
        '{"kind":"acceptance_checklist","checked":["item id or exact criterion"]} | ' +
        '{"kind":"human_sign_off","approved_by":"..."}. Omit for no surface.',
    ),
  constraints: z.string().optional(),
  boundaries: z.string().optional(),
  iteration_policy: z.string().optional(),
  stop_condition: z.string().optional(),
  budget: z.string().optional(),
  status: z.enum(goalStatuses).optional(),
});

export const updateGoalInputSchema = z.object({
  goal_id: z.string().uuid(),
  name: z.string().min(1).nullable().optional(),
  objective: z.string().min(1).optional(),
  verification_surface: z
    .string()
    .optional()
    .describe(
      'JSON verification surface. A `kind` field is REQUIRED; use exactly one of: ' +
        '{"kind":"gate_command","command":"pnpm test"} | ' +
        '{"kind":"acceptance_checklist","items":[{"criterion":"..."}]} (the server returns stable item ids) | ' +
        '{"kind":"human_sign_off"}. Omit to leave unchanged.',
    ),
  constraints: z.string().optional(),
  boundaries: z.string().optional(),
  iteration_policy: z.string().optional(),
  stop_condition: z.string().optional(),
  budget: z.string().optional(),
});

export const getGoalInputSchema = z.object({
  goal_id: z.string().uuid(),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const listGoalsInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const goalLifecycleInputSchema = z.object({
  goal_id: z.string().uuid(),
});

export const setCurrentGoalInputSchema = goalLifecycleInputSchema;

export const completeGoalInputSchema = goalLifecycleInputSchema.extend({
  evidence: verificationEvidenceSchema.optional(),
});

export const getNextTaskInputSchema = z.object({
  project_id: z.string().uuid(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Scope the frontier to a specific goal. When omitted, resolves via the project current_goal_id, then the sole active goal, then ambiguous_goal.',
    ),
  goal: z
    .string()
    .min(1)
    .optional()
    .describe('Project-scoped goal name; use this instead of goal_id.'),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_FILTER_DESCRIPTION),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const getTaskGraphInputSchema = z.object({
  project_id: z.string().uuid(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe('Scope the graph to one goal. Omit for the whole project.'),
});

export const claimTaskInputSchema = z.object({
  task_id: z.string().uuid(),
  agent_ref: z
    .string()
    .min(1)
    .describe('Identifier for the agent claiming the task (stored as assignee).'),
});

export const getTaskInputSchema = z.object({
  task_id: z.string().uuid(),
});

export const listTasksInputSchema = z.object({
  project_id: z.string().uuid(),
  status: z.enum(taskStatuses).optional(),
  kind: z.enum(taskKinds).optional(),
  priority: z.enum(taskPriorities).optional(),
  lane: z.enum(taskLanes).optional(),
  severity: z.enum(taskSeverities).optional(),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_FILTER_DESCRIPTION),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const listTagsInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const listViewsInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const listRevisionsInputSchema = z.object({
  project_id: z.string().uuid(),
  target_type: z.enum(['task', 'document']),
  target_id: z.string().uuid(),
});

export const getRevisionInputSchema = z.object({
  revision_id: z.string().uuid(),
});

export const listCommentsInputSchema = z.object({
  project_id: z.string().uuid(),
  target_type: z.enum(['document', 'task', 'note', 'submission']).optional(),
  target_id: z.string().uuid().optional(),
  include_resolved: z.boolean().optional(),
});

export const addCommentInputSchema = z.object({
  target_type: z.enum(['document', 'task', 'note', 'submission']),
  target_id: z.string().uuid(),
  body: z.string().min(1),
  passage: z.string().optional(),
});

export const addArtifactCommentInputSchema = z.object({
  project_id: z.string().uuid(),
  artifact_id: z.string().min(1),
  body: z.string().min(1),
  passage: z.string().optional(),
  anchor: z.string().optional(),
});

export const listArtifactCommentsInputSchema = z.object({
  project_id: z.string().uuid(),
  artifact_id: z.string().min(1),
  include_resolved: z.boolean().optional(),
});

export const resolveCommentInputSchema = z.object({
  comment_id: z.string().uuid(),
});

export const syncPullInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const listSubmissionsInputSchema = z.object({
  project_id: z.string().uuid(),
  status: z.enum(shareSubmissionStatuses).optional(),
});

export const triageSubmissionInputSchema = z.object({
  submission_id: z.string().uuid(),
  action: z.enum(['accept', 'reject']),
  as_task: z
    .object({
      label: z.string().optional(),
      description: z.string().optional(),
    })
    .optional()
    .describe(
      'Draft for a new task created on accept. Accepted submissions always land in `scope` — the human-only scope->todo release is structural, so status is not caller-settable here.',
    ),
  link_task_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Links the submission to an existing task instead of creating a new one via as_task. Mutually exclusive with as_task.',
    ),
});

export const searchInputSchema = z.object({
  query: z.string().min(1).describe('Title/label substring to match (documents, tasks, notes).'),
  project_id: z.string().uuid().optional().describe('Limit search to one project.'),
  workspace_id: z
    .string()
    .optional()
    .describe('Limit search to one workspace (team id). Required for workspace-scoped search.'),
  limit: z.number().int().positive().max(50).optional(),
});

export const v1ToolNames = [
  'list_projects',
  'get_project',
  'create_project',
  'update_project',
  'create_task',
  'update_task',
  'create_document',
  'update_document',
  'get_document',
  'list_documents',
  'create_folder',
  'update_folder',
  'delete_folder',
  'move_documents',
  'create_prototype',
  'list_prototypes',
  'get_prototype',
  'update_prototype',
  'create_note',
  'update_note',
  'get_note',
  'list_notes',
  'create_edge',
  'list_edges',
  'delete_edge',
  'attach_file',
  'create_artifact',
  'get_artifact',
  'update_artifact',
  'move_screen',
  'copy_screen',
  'list_artifacts',
  'create_share_link',
  'start_agent_run',
  'record_agent_progress',
  'complete_agent_run',
  'scaffold_project_from_plan',
  'create_goal',
  'get_goal',
  'list_goals',
  'update_goal',
  'set_current_goal',
  'invoke_goal',
  'pause_goal',
  'resume_goal',
  'complete_goal',
  'get_next_task',
  'get_task_graph',
  'claim_task',
  'get_task',
  'list_tasks',
  'list_tags',
  'list_views',
  'list_revisions',
  'get_revision',
  'list_comments',
  'add_comment',
  'list_artifact_comments',
  'add_artifact_comment',
  'resolve_comment',
  'search',
  'sync_pull',
  'list_submissions',
  'triage_submission',
] as const;

export type V1ToolName = (typeof v1ToolNames)[number];

export const v1ToolSchemas = {
  list_projects: listProjectsInputSchema,
  get_project: getProjectInputSchema,
  create_project: createProjectInputSchema,
  update_project: updateProjectInputSchema,
  create_task: createTaskInputSchema,
  update_task: updateTaskInputSchema,
  create_document: createDocumentInputSchema,
  update_document: updateDocumentInputSchema,
  get_document: getDocumentInputSchema,
  list_documents: listDocumentsInputSchema,
  create_folder: createFolderInputSchema,
  update_folder: updateFolderInputSchema,
  delete_folder: deleteFolderInputSchema,
  move_documents: moveDocumentsInputSchema,
  create_prototype: createPrototypeInputSchema,
  list_prototypes: listPrototypesInputSchema,
  get_prototype: getPrototypeInputSchema,
  update_prototype: updatePrototypeInputSchema,
  create_note: createNoteInputSchema,
  update_note: updateNoteInputSchema,
  get_note: getNoteInputSchema,
  list_notes: listNotesInputSchema,
  create_edge: createEdgeInputSchema,
  list_edges: listEdgesInputSchema,
  delete_edge: deleteEdgeInputSchema,
  attach_file: attachFileInputSchema,
  create_artifact: createArtifactInputSchema,
  get_artifact: getArtifactInputSchema,
  update_artifact: updateArtifactInputSchema,
  move_screen: moveScreenInputSchema,
  copy_screen: copyScreenInputSchema,
  list_artifacts: listArtifactsInputSchema,
  create_share_link: createShareLinkInputSchema,
  start_agent_run: startAgentRunInputSchema,
  record_agent_progress: recordAgentProgressInputSchema,
  complete_agent_run: completeAgentRunInputSchema,
  scaffold_project_from_plan: scaffoldProjectFromPlanInputSchema,
  create_goal: createGoalInputSchema,
  get_goal: getGoalInputSchema,
  list_goals: listGoalsInputSchema,
  update_goal: updateGoalInputSchema,
  set_current_goal: setCurrentGoalInputSchema,
  invoke_goal: goalLifecycleInputSchema,
  pause_goal: goalLifecycleInputSchema,
  resume_goal: goalLifecycleInputSchema,
  complete_goal: completeGoalInputSchema,
  get_next_task: getNextTaskInputSchema,
  get_task_graph: getTaskGraphInputSchema,
  claim_task: claimTaskInputSchema,
  get_task: getTaskInputSchema,
  list_tasks: listTasksInputSchema,
  list_tags: listTagsInputSchema,
  list_views: listViewsInputSchema,
  list_revisions: listRevisionsInputSchema,
  get_revision: getRevisionInputSchema,
  list_comments: listCommentsInputSchema,
  add_comment: addCommentInputSchema,
  list_artifact_comments: listArtifactCommentsInputSchema,
  add_artifact_comment: addArtifactCommentInputSchema,
  resolve_comment: resolveCommentInputSchema,
  search: searchInputSchema,
  sync_pull: syncPullInputSchema,
  list_submissions: listSubmissionsInputSchema,
  triage_submission: triageSubmissionInputSchema,
} as const;
