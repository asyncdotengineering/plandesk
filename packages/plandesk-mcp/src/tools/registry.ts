import { z } from 'zod';
import { commitRefsField, dueDateField, verifiedAtField, verifiedRefField } from '@plandesk/api';
import {
  artifactKinds,
  commentTargetTypesForComments,
  goalStatuses,
  isValidRepoRelativePath,
  isValidRepoUrl,
  linkEntityTypes,
  revisionTargetTypesForList,
  shareSubmissionStatuses,
  taskKinds,
  taskLanes,
  taskPriorities,
  taskSeverities,
  taskStatuses,
  terminalAgentRunStatuses,
} from '@plandesk/db';

const repoUrlSchema = z
  .string()
  .refine(isValidRepoUrl, { message: 'invalid repo_url' })
  .nullable()
  .optional();

const folderPathSchema = z
  .string()
  .refine(isValidRepoRelativePath, { message: 'invalid folder_path' })
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
  'Hex commit SHAs (7–40 chars, case-insensitive; stored lowercase) that shipped this task. At most 50. Replaces the FULL array; pass null to clear. Omit on update to leave unchanged.';

const COMMIT_REFS_FIELD = commitRefsField.describe(COMMIT_REFS_DESCRIPTION);

const DUE_DATE_FIELD = dueDateField.describe(
  'Due date (ISO 8601 string). Pass null to clear on update.',
);

const SOURCE_PATH_FIELD = z
  .string()
  .refine(isValidRepoRelativePath, { message: 'invalid source_path' })
  .nullable()
  .optional()
  .describe(
    'Repo-relative path to the file this document mirrors. Pass null to clear. Never absolute and never contains .. segments.',
  );

const VERIFIED_AT_FIELD = verifiedAtField.describe(
  'When this item was last verified against reality (ISO 8601). Explicit only — ordinary edits do not change it.',
);

const VERIFIED_REF_FIELD = verifiedRefField.describe(
  'Commit SHA or short ref recorded with verified_at. Requires verified_at when set.',
);

const TAGS_FILTER_DESCRIPTION =
  'Optional tag-name filter with OR semantics: a task matches if it carries ANY of the given tags.';

const VERBOSE_DESCRIPTION =
  'When true, includes large body/description fields. Defaults to false so list reads are cheap and bounded.';

const TASK_DESCRIPTION_GUIDANCE =
  "Non-trivial tasks need build-contract depth (see .plandesk/skill.md's Task creation conventions): Problem, Action Items, Interfaces (concrete signatures/types/API/CLI this task touches, named exactly), Pseudocode (control flow for anything non-obvious), Validation contract (the test/command/observable outcome that proves it done), and References. No internal RFC/PRD/ticket references embedded in the text — the task must be executable without re-reading a parent doc.";

export const listProjectsInputSchema = z.strictObject({});

export const createProjectInputSchema = z.strictObject({
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

export const updateProjectInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  owner_id: z.string().min(1).nullable().optional(),
  overview_document_id: z.string().uuid().nullable().optional(),
  repo_url: repoUrlSchema,
  folder_path: folderPathSchema,
});

export const getProjectInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const createTaskInputSchema = z.strictObject({
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
    .nullable()
    .optional()
    .describe(
      'Goal this task belongs to. Omit to attach to the current goal (see goal_resolution on create). Pass null for no goal.',
    ),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_SET_DESCRIPTION),
  commit_refs: COMMIT_REFS_FIELD,
  due_date: DUE_DATE_FIELD,
});

export const updateTaskInputSchema = z.strictObject({
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
    .nullable()
    .optional()
    .describe(
      'Reassign the task to a goal in the same project, or null to detach from all goals. Omit to leave unchanged.',
    ),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_SET_DESCRIPTION),
  commit_refs: COMMIT_REFS_FIELD,
  due_date: DUE_DATE_FIELD,
  verified_at: VERIFIED_AT_FIELD,
  verified_ref: VERIFIED_REF_FIELD,
});

export const createDocumentInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  link_to: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .describe(LINK_TO_DESCRIPTION),
  parent_id: z.string().uuid().optional(),
  status_line: z.string().optional(),
  folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Folder to place the document in on create. Omit for Unfiled (project root).'),
  source_path: SOURCE_PATH_FIELD,
});

export const updateDocumentInputSchema = z.strictObject({
  document_id: z.string().uuid(),
  title: z.string().optional(),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  status_line: z.string().optional(),
  parent_id: z.string().uuid().nullable().optional(),
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
  source_path: SOURCE_PATH_FIELD,
  verified_at: VERIFIED_AT_FIELD,
  verified_ref: VERIFIED_REF_FIELD,
});

export const checkReferencesInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const getDocumentInputSchema = z.strictObject({
  document_id: z.string().uuid(),
});

export const listDocumentsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Only list documents inside this folder. Omit for the full folder tree.'),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const createFolderInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  name: z.string().min(1),
  parent_folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Parent folder for nesting. Omit to create the folder at the project root.'),
});

export const updateFolderInputSchema = z.strictObject({
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

export const deleteFolderInputSchema = z.strictObject({
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

export const moveDocumentsInputSchema = z.strictObject({
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

export const createNoteInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional().describe(NOTE_BODY_DESCRIPTION),
});

export const updateNoteInputSchema = z.strictObject({
  note_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  body: z.string().optional().describe(NOTE_BODY_DESCRIPTION),
});

export const getNoteInputSchema = z.strictObject({
  note_id: z.string().uuid(),
});

export const listNotesInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const createShareLinkInputSchema = z.strictObject({
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

export const createPrototypeInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  name: z.string().min(1),
  viewport_width: z.number().positive().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
  viewport_height: z.number().positive().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
});

export const listPrototypesInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const getPrototypeInputSchema = z.strictObject({
  prototype_id: z.string().uuid(),
});

export const updatePrototypeInputSchema = z.strictObject({
  prototype_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  viewport_width: z.number().positive().optional().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
  viewport_height: z.number().positive().optional().describe(PROTOTYPE_VIEWPORT_DESCRIPTION),
});

export const createArtifactInputSchema = z.strictObject({
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
  folder_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'File this artifact in a document folder so it sits beside the documents it belongs with. Omit or null for unfiled. Must belong to the same project. Not allowed together with prototype_id — a screen is laid out from its prototype, not filed.',
    ),
});

export const getArtifactInputSchema = z.strictObject({
  artifact_id: z.string().uuid(),
});

export const moveScreenInputSchema = z.strictObject({
  artifact_id: z.string().uuid(),
  prototype_id: z.string().uuid().describe('Destination prototype in the same project.'),
});

export const copyScreenInputSchema = z.strictObject({
  artifact_id: z.string().uuid(),
  prototype_id: z.string().uuid().describe('Destination prototype in the same project.'),
});

export const updateArtifactInputSchema = z.strictObject({
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
  folder_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'Move this artifact to a document folder, or pass null to unfile it. Must belong to the same project. Not allowed on a prototype screen.',
    ),
});

export const listArtifactsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const attachFileInputSchema = z.strictObject({
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

export const createEdgeInputSchema = z.strictObject({
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
  arrow_direction: z.string().nullable().optional(),
});

export const listEdgesInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const deleteEdgeInputSchema = z.strictObject({
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
  source_path: z.string().nullable(),
  verified_at: z.string().nullable(),
  verified_ref: z.string().nullable(),
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

export const startAgentRunInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  label: z.string().optional(),
});

export const recordAgentProgressInputSchema = z.strictObject({
  run_id: z.string().uuid(),
  message: z.string().min(1),
});

export const completeAgentRunInputSchema = z.strictObject({
  run_id: z.string().uuid(),
  status: z.enum(
    terminalAgentRunStatuses as [
      (typeof terminalAgentRunStatuses)[number],
      ...(typeof terminalAgentRunStatuses)[number][],
    ],
  ),
});

export const scaffoldProjectFromPlanInputSchema = z.strictObject({
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
    .nullable()
    .optional()
    .describe(
      'Goal to attach scaffolded tasks to; must belong to the target project. Omit to use the current goal (then the sole active goal); pass null for tasks that belong to no goal.',
    ),
  tasks: z
    .array(
      z
        .object({
          key: z.string().min(1),
          label: z.string().min(1),
          status: z.enum(taskStatuses).optional(),
          kind: z.enum(taskKinds).optional(),
          priority: z.enum(taskPriorities).nullable().optional(),
          lane: z.enum(taskLanes).nullable().optional(),
          severity: z.enum(taskSeverities).nullable().optional(),
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
          tags: z.array(z.string().min(1)).optional().describe(TAGS_SET_DESCRIPTION),
          assignee: z.string().min(1).nullable().optional(),
        })
        .strict(),
    )
    .min(1),
  edges: z
    .array(
      z
        .object({
          from: z.string().min(1),
          to: z.string().min(1),
          label: z.string().optional(),
          style: z.string().optional(),
        })
        .strict(),
    )
    .optional(),
  documents: z
    .array(
      z
        .object({
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
        })
        .strict(),
    )
    .optional(),
});

const verificationEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('gate_command'),
    exit_code: z.number(),
    command: z.string().optional(),
    detail: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('acceptance_checklist'),
    checked: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal('human_sign_off'),
    approved_by: z.string(),
  }),
]);

export const createGoalInputSchema = z.strictObject({
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

export const updateGoalInputSchema = z.strictObject({
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

export const getGoalInputSchema = z.strictObject({
  goal_id: z.string().uuid(),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const listGoalsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const goalLifecycleInputSchema = z.strictObject({
  goal_id: z.string().uuid(),
});

export const setCurrentGoalInputSchema = goalLifecycleInputSchema;

export const completeGoalInputSchema = goalLifecycleInputSchema.extend({
  evidence: verificationEvidenceSchema.optional(),
});

export const getNextTaskInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  goal_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'Scope the frontier to a specific goal, or null for goal-less todo tasks only. When omitted, resolves via current_goal_id, then the sole active goal, then the goal-less frontier when no goals are active.',
    ),
  goal: z
    .string()
    .min(1)
    .optional()
    .describe('Project-scoped goal name; use this instead of goal_id.'),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_FILTER_DESCRIPTION),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const getTaskGraphInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe('Scope the graph to one goal. Omit for the whole project.'),
});

export const claimTaskInputSchema = z.strictObject({
  task_id: z.string().uuid(),
  agent_ref: z
    .string()
    .min(1)
    .describe('Identifier for the agent claiming the task (stored as assignee).'),
});

export const getTaskInputSchema = z.strictObject({
  task_id: z.string().uuid(),
});

export const listTasksInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  status: z.enum(taskStatuses).optional(),
  kind: z.enum(taskKinds).optional(),
  priority: z.enum(taskPriorities).optional(),
  lane: z.enum(taskLanes).optional(),
  severity: z.enum(taskSeverities).optional(),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_FILTER_DESCRIPTION),
  verbose: z.boolean().optional().describe(VERBOSE_DESCRIPTION),
});

export const listTagsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const listViewsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
});

export const listRevisionsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  target_type: z.enum(
    revisionTargetTypesForList as [
      (typeof revisionTargetTypesForList)[number],
      ...(typeof revisionTargetTypesForList)[number][],
    ],
  ),
  target_id: z.string().uuid(),
});

export const getRevisionInputSchema = z.strictObject({
  revision_id: z.string().uuid(),
});

export const listCommentsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  target_type: z
    .enum(
      commentTargetTypesForComments as [
        (typeof commentTargetTypesForComments)[number],
        ...(typeof commentTargetTypesForComments)[number][],
      ],
    )
    .optional(),
  target_id: z.string().uuid().optional(),
  include_resolved: z.boolean().optional(),
});

export const addCommentInputSchema = z.strictObject({
  target_type: z.enum(
    commentTargetTypesForComments as [
      (typeof commentTargetTypesForComments)[number],
      ...(typeof commentTargetTypesForComments)[number][],
    ],
  ),
  target_id: z.string().uuid(),
  body: z.string().min(1),
  passage: z.string().optional(),
});

export const addArtifactCommentInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  artifact_id: z.string().min(1),
  body: z.string().min(1),
  passage: z.string().optional(),
  anchor: z.string().optional(),
});

export const listArtifactCommentsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  artifact_id: z.string().min(1),
  include_resolved: z.boolean().optional(),
});

export const resolveCommentInputSchema = z.strictObject({
  comment_id: z.string().uuid(),
});

export const listSubmissionsInputSchema = z.strictObject({
  project_id: z.string().uuid(),
  status: z.enum(shareSubmissionStatuses).optional(),
});

export const triageSubmissionInputSchema = z.strictObject({
  submission_id: z.string().uuid(),
  action: z.enum(['accept', 'reject']),
  as_task: z
    .object({
      label: z.string().optional(),
      description: z.string().optional(),
    })
    .strict()
    .optional()
    .describe(
      'Draft for a new task created on accept. Accepted submissions always land in `scope` — the human-only scope->todo release is structural, so `status` is not accepted (do not send it).',
    ),
  link_task_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Links the submission to an existing task instead of creating a new one via as_task. Mutually exclusive with as_task.',
    ),
});

export const searchInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .describe('Text to match in titles, labels, or bodies (documents, tasks, notes).'),
  project_id: z.string().uuid().optional().describe('Limit search to one project.'),
  workspace_id: z
    .string()
    .optional()
    .describe('Limit search to one workspace (team id). Required for workspace-scoped search.'),
  limit: z.number().int().positive().max(50).optional(),
});
