import { z } from 'zod';
import { artifactKinds, goalStatuses, shareSubmissionStatuses, taskStatuses } from '@plandesk/db';

const DOCUMENT_BODY_DESCRIPTION =
  'Document body in Markdown (rendered as rich text). Structure it well: `##` headings, bullet lists, fenced code blocks, and blank lines between paragraphs. HTML is also accepted.';

const NOTE_BODY_DESCRIPTION =
  'Note body in Markdown (rendered as rich text). Notes are free-form working notes scoped to the project — use them for findings, context, or anything worth referring back to. HTML is also accepted.';

const LINKED_TASK_DESCRIPTION =
  'ID (uuid) of the task this document is the spec for. Links the document to its primary task.';

const TAGS_SET_DESCRIPTION =
  'Tag names to set on the task. Replaces the FULL tag set; tags that do not exist yet in the project are auto-created by name. Pass [] to remove all tags.';

const TAGS_FILTER_DESCRIPTION =
  'Optional tag-name filter with OR semantics: a task matches if it carries ANY of the given tags.';

const COMPACT_DESCRIPTION =
  'When true, omits large body/description fields and returns only id + summary metadata — use this for a cheap board-reconciliation sweep. Defaults to false (full body included), for backward compatibility.';

const TASK_DESCRIPTION_GUIDANCE =
  "Non-trivial tasks need build-contract depth (see .plandesk/skill.md's Task creation conventions): Problem, Action Items, Interfaces (concrete signatures/types/API/CLI this task touches, named exactly), Pseudocode (control flow for anything non-obvious), Validation contract (the test/command/observable outcome that proves it done), and References. No internal RFC/PRD/ticket references embedded in the text — the task must be executable without re-reading a parent doc.";

export const listProjectsInputSchema = z.object({});

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const getProjectInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const createTaskInputSchema = z.object({
  project_id: z.string().uuid(),
  label: z.string().min(1),
  status: z.enum(taskStatuses).optional(),
  description: z.string().optional().describe(TASK_DESCRIPTION_GUIDANCE),
  x: z.number().optional(),
  y: z.number().optional(),
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
  label: z.string().optional(),
  description: z.string().optional().describe(TASK_DESCRIPTION_GUIDANCE),
  x: z.number().optional(),
  y: z.number().optional(),
  goal_id: z
    .string()
    .uuid()
    .optional()
    .describe('Reassign the task to a different goal in the same project. Omit to leave it unchanged.'),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_SET_DESCRIPTION),
});

export const createDocumentInputSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  linked_task_id: z.string().uuid().optional().describe(LINKED_TASK_DESCRIPTION),
  parent_id: z.string().uuid().optional(),
  folder_id: z
    .string()
    .uuid()
    .optional()
    .describe('Folder to place the document in. Omit for the project root.'),
});

export const updateDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
  title: z.string().optional(),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  status_line: z.string().optional(),
  linked_task_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(`${LINKED_TASK_DESCRIPTION} Pass null to unlink the document from its task.`),
  folder_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('Move the document into a folder. Pass null to move it back to the project root.'),
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
  compact: z.boolean().optional().describe(COMPACT_DESCRIPTION),
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
});

export const createShareLinkInputSchema = z.object({
  task_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  expires: z
    .enum(['24h', '7d', 'never'])
    .optional()
    .describe('Link TTL. Defaults to 24h; never means the link does not expire.'),
});

const ARTIFACT_CONTENT_DESCRIPTION =
  'Artifact body. Markdown or HTML depending on kind — a report, RFC, or diagram a human can review with the CLI previewer.';

export const createArtifactInputSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().describe(ARTIFACT_CONTENT_DESCRIPTION),
  kind: z.enum(artifactKinds).optional().describe('Defaults to markdown.'),
});

export const getArtifactInputSchema = z.object({
  artifact_id: z.string().uuid(),
});

export const updateArtifactInputSchema = z.object({
  artifact_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  content: z.string().optional().describe(ARTIFACT_CONTENT_DESCRIPTION),
  kind: z.enum(artifactKinds).optional(),
});

export const listArtifactsInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const attachFileInputSchema = z.object({
  project_id: z.string().uuid(),
  filename: z.string().min(1),
  content_base64: z.string().min(1),
  mime: z.string().min(1).optional().describe('Defaults to image/png.'),
});

export const createEdgeInputSchema = z.object({
  project_id: z.string().uuid(),
  from_task_id: z.string().uuid(),
  to_task_id: z.string().uuid(),
  label: z.string().optional(),
  style: z.string().optional(),
});

export const listEdgesInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const deleteEdgeInputSchema = z.object({
  edge_id: z.string().uuid(),
});

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
    .describe('Name for a NEW project. Required when `project_id` is omitted; ignored when it is set.'),
  description: z.string().optional(),
  tasks: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        status: z.enum(taskStatuses).optional(),
        description: z.string().optional().describe(TASK_DESCRIPTION_GUIDANCE),
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
        title: z.string().min(1),
        body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
        status_line: z.string().optional(),
        link_to: z.string().optional(),
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
  objective: z.string().min(1),
  verification_surface: z
    .string()
    .optional()
    .describe(
      'JSON verification surface. A `kind` field is REQUIRED; use exactly one of: ' +
        '{"kind":"gate_command","command":"pnpm test"} | ' +
        '{"kind":"acceptance_checklist","items":[{"criterion":"..."}]} | ' +
        '{"kind":"human_sign_off"}. ' +
        'complete_goal later takes matching evidence: {"kind":"gate_command","exit_code":0} | ' +
        '{"kind":"acceptance_checklist","checked":["..."]} | ' +
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
  objective: z.string().min(1).optional(),
  verification_surface: z
    .string()
    .optional()
    .describe(
      'JSON verification surface. A `kind` field is REQUIRED; use exactly one of: ' +
        '{"kind":"gate_command","command":"pnpm test"} | ' +
        '{"kind":"acceptance_checklist","items":[{"criterion":"..."}]} | ' +
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
});

export const listGoalsInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const goalLifecycleInputSchema = z.object({
  goal_id: z.string().uuid(),
});

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
      'Scope the frontier to a specific goal. When omitted, uses the project sole active goal.',
    ),
  tags: z.array(z.string().min(1)).optional().describe(TAGS_FILTER_DESCRIPTION),
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
  tags: z.array(z.string().min(1)).optional().describe(TAGS_FILTER_DESCRIPTION),
  compact: z.boolean().optional().describe(COMPACT_DESCRIPTION),
});

export const listTagsInputSchema = z.object({
  project_id: z.string().uuid(),
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

export const v1ToolNames = [
  'list_projects',
  'get_project',
  'create_project',
  'create_task',
  'update_task',
  'create_document',
  'update_document',
  'get_document',
  'list_documents',
  'create_folder',
  'update_folder',
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
  'pause_goal',
  'resume_goal',
  'complete_goal',
  'get_next_task',
  'claim_task',
  'get_task',
  'list_tasks',
  'list_tags',
  'list_comments',
  'add_comment',
  'list_artifact_comments',
  'add_artifact_comment',
  'resolve_comment',
  'sync_pull',
  'list_submissions',
  'triage_submission',
] as const;

export type V1ToolName = (typeof v1ToolNames)[number];

export const v1ToolSchemas = {
  list_projects: listProjectsInputSchema,
  get_project: getProjectInputSchema,
  create_project: createProjectInputSchema,
  create_task: createTaskInputSchema,
  update_task: updateTaskInputSchema,
  create_document: createDocumentInputSchema,
  update_document: updateDocumentInputSchema,
  get_document: getDocumentInputSchema,
  list_documents: listDocumentsInputSchema,
  create_folder: createFolderInputSchema,
  update_folder: updateFolderInputSchema,
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
  pause_goal: goalLifecycleInputSchema,
  resume_goal: goalLifecycleInputSchema,
  complete_goal: completeGoalInputSchema,
  get_next_task: getNextTaskInputSchema,
  claim_task: claimTaskInputSchema,
  get_task: getTaskInputSchema,
  list_tasks: listTasksInputSchema,
  list_tags: listTagsInputSchema,
  list_comments: listCommentsInputSchema,
  add_comment: addCommentInputSchema,
  list_artifact_comments: listArtifactCommentsInputSchema,
  add_artifact_comment: addArtifactCommentInputSchema,
  resolve_comment: resolveCommentInputSchema,
  sync_pull: syncPullInputSchema,
  list_submissions: listSubmissionsInputSchema,
  triage_submission: triageSubmissionInputSchema,
} as const;
