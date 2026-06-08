import { z } from 'zod';
import { taskStatuses } from '@plandesk/db';

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
  body: z.string().optional(),
  linked_task_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
});

export const updateDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
  title: z.string().optional(),
  body: z.string().optional(),
  status_line: z.string().optional(),
});

export const getDocumentInputSchema = z.object({
  document_id: z.string().uuid(),
});

export const listDocumentsInputSchema = z.object({
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
        body: z.string().optional(),
        status_line: z.string().optional(),
        link_to: z.string().optional(),
      }),
    )
    .optional(),
});

export const getNextTaskInputSchema = z.object({
  project_id: z.string().uuid(),
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
  'create_edge',
  'start_agent_run',
  'record_agent_progress',
  'complete_agent_run',
  'scaffold_project_from_plan',
  'get_next_task',
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
  create_edge: createEdgeInputSchema,
  start_agent_run: startAgentRunInputSchema,
  record_agent_progress: recordAgentProgressInputSchema,
  complete_agent_run: completeAgentRunInputSchema,
  scaffold_project_from_plan: scaffoldProjectFromPlanInputSchema,
  get_next_task: getNextTaskInputSchema,
} as const;
