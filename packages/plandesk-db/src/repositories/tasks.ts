import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { projects, tags, taskStatuses, taskTags, tasks, type TaskStatus } from '../schema.js';

export type Task = typeof tasks.$inferSelect;

export type NewTask = {
  projectId: string;
  goalId: string;
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
  goalId?: string;
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

export async function createTask(db: DbClient, input: NewTask): Promise<Task> {
  const status = input.status ?? 'todo';
  assertTaskStatus(status);
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(tasks)
    .values({
      id,
      projectId: input.projectId,
      goalId: input.goalId,
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

export async function getTask(db: DbClient, id: string): Promise<Task | undefined> {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export type ListTasksOptions = {
  status?: TaskStatus;
  // OR semantics: keep tasks carrying ANY of the given tag names.
  tagNames?: string[];
  limit?: number;
  offset?: number;
};

export async function listTasks(
  db: DbClient,
  projectId: string,
  options?: ListTasksOptions,
): Promise<Task[]> {
  const conditions = [eq(tasks.projectId, projectId)];
  if (options?.status !== undefined) {
    conditions.push(eq(tasks.status, options.status));
  }
  if (options?.tagNames !== undefined && options.tagNames.length > 0) {
    conditions.push(
      inArray(
        tasks.id,
        db
          .select({ taskId: taskTags.taskId })
          .from(taskTags)
          .innerJoin(tags, eq(taskTags.tagId, tags.id))
          .where(and(eq(tags.projectId, projectId), inArray(tags.name, options.tagNames))),
      ),
    );
  }
  let query = db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export async function listTaskStatusesByIds(
  db: DbClient,
  projectId: string,
  ids: string[],
): Promise<{ id: string; status: TaskStatus }[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, ids)))
    .all();
}

export async function deleteTask(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(tasks).where(eq(tasks.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deleteTasksByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(tasks).where(eq(tasks.projectId, projectId)).run();
  return result.rowsAffected;
}

export type UpdateTaskOptions = {
  expectedUpdatedAt?: Date;
};

export async function updateTask(
  db: DbClient,
  id: string,
  input: TaskUpdate,
  options?: UpdateTaskOptions,
): Promise<Task | undefined> {
  if (input.status !== undefined) {
    assertTaskStatus(input.status);
  }
  const now = new Date();
  const conditions = [eq(tasks.id, id)];
  if (options?.expectedUpdatedAt !== undefined) {
    conditions.push(eq(tasks.updatedAt, options.expectedUpdatedAt));
  }
  const rows = await db
    .update(tasks)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(and(...conditions))
    .returning()
    .all();
  return rows[0];
}

export async function claimTask(
  db: DbClient,
  id: string,
  orgId: string,
  agentRef: string,
): Promise<Task | undefined> {
  const now = new Date();
  const rows = await db
    .update(tasks)
    .set({
      status: 'in_progress',
      assignee: agentRef,
      updatedAt: now,
    })
    .where(
      and(
        eq(tasks.id, id),
        eq(tasks.status, 'todo'),
        inArray(
          tasks.projectId,
          db.select({ id: projects.id }).from(projects).where(eq(projects.orgId, orgId)),
        ),
      ),
    )
    .returning()
    .all();
  return rows[0];
}
