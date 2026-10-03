import { z } from 'zod';
import { taskMutableZodFields, verifiedAtField, verifiedRefField } from '../task-fields.js';

export const patchTaskBodySchema = z
  .object({
    label: z.string().optional(),
    goal_id: z.string().uuid().nullable().optional(),
    ...taskMutableZodFields,
    // Verification is an event on an existing task, so only updates carry it.
    verified_at: verifiedAtField,
    verified_ref: verifiedRefField,
  })
  .strict();

export const createProjectTaskBodySchema = z
  .object({
    label: z.string().min(1),
    ...taskMutableZodFields,
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
