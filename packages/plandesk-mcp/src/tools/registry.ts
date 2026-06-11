import { z } from 'zod';
import { shareSubmissionStatuses, taskStatuses } from '@plandesk/db';

const DOCUMENT_BODY_DESCRIPTION =
  'Document body in Markdown (rendered as rich text). Structure it well: `##` headings, bullet lists, fenced code blocks, and blank lines between paragraphs. HTML is also accepted.';

const NOTE_BODY_DESCRIPTION =
  'Note body in Markdown (rendered as rich text). Notes are free-form working notes scoped to the project — use them for findings, context, or anything worth referring back to. HTML is also accepted.';

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
  description: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const updateTaskInputSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(taskStatuses).optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const createDocumentInputSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  linked_task_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
});

export const updateDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
  title: z.string().optional(),
  body: z.string().optional().describe(DOCUMENT_BODY_DESCRIPTION),
  status_line: z.string().optional(),
});

export const getDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
});

export const listDocumentsInputSchema = z.object({
  project_id: z.string().uuid(),
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

export const createEdgeInputSchema = z.object({
  project_id: z.string().uuid(),
  from_task_id: z.string().uuid(),
  to_task_id: z.string().uuid(),
  label: z.string().optional(),
  style: z.string().optional(),
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
  name: z.string().min(1),
  description: z.string().optional(),
  tasks: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        status: z.enum(taskStatuses).optional(),
        description: z.string().optional(),
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

export const getNextTaskInputSchema = z.object({
  project_id: z.string().uuid(),
});

export const listCommentsInputSchema = z.object({
  project_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  include_resolved: z.boolean().optional(),
});

export const addCommentInputSchema = z.object({
  document_id: z.string().uuid(),
  body: z.string().min(1),
  passage: z.string().optional(),
});

export const resolveCommentInputSchema = z.object({
  comment_id: z.string().uuid(),
});

export const publishProjectInputSchema = z.object({
  project_id: z.string().uuid(),
  server_url: z.string().url(),
  sync_token: z.string().min(1),
});

export const syncPushInputSchema = z.object({
  project_id: z.string().uuid(),
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
      status: z.enum(taskStatuses).optional(),
      description: z.string().optional(),
    })
    .optional(),
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
  'create_note',
  'update_note',
  'get_note',
  'list_notes',
  'create_edge',
  'start_agent_run',
  'record_agent_progress',
  'complete_agent_run',
  'scaffold_project_from_plan',
  'get_next_task',
  'list_comments',
  'add_comment',
  'resolve_comment',
  'publish_project',
  'sync_push',
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
  create_note: createNoteInputSchema,
  update_note: updateNoteInputSchema,
  get_note: getNoteInputSchema,
  list_notes: listNotesInputSchema,
  create_edge: createEdgeInputSchema,
  start_agent_run: startAgentRunInputSchema,
  record_agent_progress: recordAgentProgressInputSchema,
  complete_agent_run: completeAgentRunInputSchema,
  scaffold_project_from_plan: scaffoldProjectFromPlanInputSchema,
  get_next_task: getNextTaskInputSchema,
  list_comments: listCommentsInputSchema,
  add_comment: addCommentInputSchema,
  resolve_comment: resolveCommentInputSchema,
  publish_project: publishProjectInputSchema,
  sync_push: syncPushInputSchema,
  sync_pull: syncPullInputSchema,
  list_submissions: listSubmissionsInputSchema,
  triage_submission: triageSubmissionInputSchema,
} as const;
