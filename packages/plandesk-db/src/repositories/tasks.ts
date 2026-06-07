import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { taskStatuses, tasks, type TaskStatus } from '../schema.js';

export type Task = typeof tasks.$inferSelect;

export type NewTask = {
  projectId: string;
  label: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  dueDate?: Date | null;
  id?: string;
};

export type TaskUpdate = {
  label?: string;
  status?: TaskStatus;
  description?: string | null;
  x?: number;
  y?: number;
  assignee?: string | null;
  dueDate?: Date | null;
};

export class InvalidTaskStatusError extends Error {
  constructor(status: string) {
    super(`Invalid task status: ${status}`);
    this.name = 'InvalidTaskStatusError';
  }
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (taskStatuses as readonly string[]).includes(value);
}

function assertTaskStatus(status: string): asserts status is TaskStatus {
  if (!isTaskStatus(status)) {
    throw new InvalidTaskStatusError(status);
  }
}

export function createTask(db: DbClient, input: NewTask): Task {
  const status = input.status ?? 'todo';
  assertTaskStatus(status);
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(tasks)
    .values({
      id,
      projectId: input.projectId,
      label: input.label,
      status,
      description: input.description ?? null,
      x: input.x ?? 0,
      y: input.y ?? 0,
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create task');
  }
  return row;
}

export function getTask(db: DbClient, id: string): Task | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export type ListTasksOptions = {
  status?: TaskStatus;
};

export function listTasks(db: DbClient, projectId: string, options?: ListTasksOptions): Task[] {
  const conditions = [eq(tasks.projectId, projectId)];
  if (options?.status !== undefined) {
    conditions.push(eq(tasks.status, options.status));
  }
  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .all();
}

export function updateTask(db: DbClient, id: string, input: TaskUpdate): Task | undefined {
  if (input.status !== undefined) {
    assertTaskStatus(input.status);
  }
  const now = new Date();
  const rows = db
    .update(tasks)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(tasks.id, id))
    .returning()
    .all();
  return rows[0];
}
