import { z } from 'zod';
import {
  isValidCommitRef,
  MAX_COMMIT_REFS,
  taskKinds,
  taskLanes,
  taskPriorities,
  taskSeverities,
  taskStatuses,
} from '@plandesk/db';

const dueDateField = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'due_date must be a valid date',
  })
  .nullable()
  .optional();

const commitRefsField = z
  .array(z.string().refine(isValidCommitRef, { message: 'invalid commit_ref' }))
  .max(MAX_COMMIT_REFS)
  .nullable()
  .optional();

const tagsField = z.array(z.string().min(1)).optional();

const taskMutableFields = {
  status: z.enum(taskStatuses).optional(),
  kind: z.enum(taskKinds).optional(),
  priority: z.enum(taskPriorities).nullable().optional(),
  lane: z.enum(taskLanes).nullable().optional(),
  severity: z.enum(taskSeverities).nullable().optional(),
  description: z.string().nullable().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  assignee: z.string().min(1).nullable().optional(),
  due_date: dueDateField,
  tags: tagsField,
  commit_refs: commitRefsField,
};

export const patchTaskBodySchema = z
  .object({
    label: z.string().optional(),
    goal_id: z.string().uuid().nullable().optional(),
    ...taskMutableFields,
  })
  .strict();

export const createProjectTaskBodySchema = z
  .object({
    label: z.string().min(1),
    ...taskMutableFields,
    goal_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export function zodValidationField(error: z.ZodError): { field: string; message: string } {
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys' && issue.keys.length > 0) {
      const key = issue.keys[0];
      return { field: String(key), message: issue.message };
    }
    if (issue.path.length > 0) {
      const field = String(issue.path[issue.path.length - 1]);
      return { field, message: issue.message };
    }
  }
  return { field: 'body', message: error.message };
}

export function parseDueDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return new Date(value);
}
