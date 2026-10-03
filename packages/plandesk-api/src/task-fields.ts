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

export const dueDateField = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'due_date must be a valid date',
  })
  .nullable()
  .optional();

export const commitRefsField = z
  .array(z.string().refine(isValidCommitRef, { message: 'invalid commit_ref' }))
  .max(MAX_COMMIT_REFS)
  .nullable()
  .optional();

export const verifiedAtField = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'verified_at must be a valid date',
  })
  .nullable()
  .optional();

export const verifiedRefField = z.string().min(1).nullable().optional();

export const tagsField = z.array(z.string().min(1)).optional();

export const taskMutableZodFields = {
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
