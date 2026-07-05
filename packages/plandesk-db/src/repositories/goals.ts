import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { goalStatuses, goals, type GoalStatus } from '../schema.js';

export type Goal = typeof goals.$inferSelect;

export type NewGoal = {
  projectId: string;
  objective: string;
  status?: GoalStatus;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
  id?: string;
};

export type GoalUpdate = {
  objective?: string;
  status?: GoalStatus;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
};

export class InvalidGoalStatusError extends Error {
  constructor(status: string) {
    super(`Invalid goal status: ${status}`);
    this.name = 'InvalidGoalStatusError';
  }
}

export function isGoalStatus(value: string): value is GoalStatus {
  return (goalStatuses as readonly string[]).includes(value);
}

function assertGoalStatus(status: string): asserts status is GoalStatus {
  if (!isGoalStatus(status)) {
    throw new InvalidGoalStatusError(status);
  }
}

export function createGoal(db: DbClient, input: NewGoal): Goal {
  const status = input.status ?? 'active';
  assertGoalStatus(status);
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(goals)
    .values({
      id,
      projectId: input.projectId,
      objective: input.objective,
      status,
      verificationSurface: input.verificationSurface ?? null,
      constraints: input.constraints ?? null,
      boundaries: input.boundaries ?? null,
      iterationPolicy: input.iterationPolicy ?? null,
      stopCondition: input.stopCondition ?? null,
      budget: input.budget ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create goal');
  }
  return row;
}

export function getGoal(db: DbClient, id: string): Goal | undefined {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

export function listGoals(db: DbClient, projectId: string): Goal[] {
  return db
    .select()
    .from(goals)
    .where(eq(goals.projectId, projectId))
    .orderBy(asc(goals.createdAt), asc(goals.id))
    .all();
}

export function updateGoal(db: DbClient, id: string, input: GoalUpdate): Goal | undefined {
  if (input.status !== undefined) {
    assertGoalStatus(input.status);
  }
  const now = new Date();
  const rows = db
    .update(goals)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(goals.id, id))
    .returning()
    .all();
  return rows[0];
}

export function updateGoalStatus(
  db: DbClient,
  id: string,
  status: GoalStatus,
): Goal | undefined {
  return updateGoal(db, id, { status });
}

export function getOrCreateDefaultGoal(db: DbClient, projectId: string): Goal {
  const existing = db
    .select()
    .from(goals)
    .where(eq(goals.projectId, projectId))
    .orderBy(asc(goals.createdAt), asc(goals.id))
    .limit(1)
    .get();
  if (existing) {
    return existing;
  }
  return createGoal(db, {
    projectId,
    objective: 'General',
    status: 'active',
  });
}

export function deleteGoalsByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(goals).where(eq(goals.projectId, projectId)).run();
  return result.changes;
}