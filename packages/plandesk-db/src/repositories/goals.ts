import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { goalStatuses, goals, projects, type GoalStatus } from '../schema.js';

export type Goal = typeof goals.$inferSelect;

export type NewGoal = {
  projectId: string;
  objective: string;
  name?: string | null;
  status?: GoalStatus;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
  lastVerification?: string | null;
  id?: string;
};

export type GoalUpdate = {
  objective?: string;
  name?: string | null;
  status?: GoalStatus;
  verificationSurface?: string | null;
  constraints?: string | null;
  boundaries?: string | null;
  iterationPolicy?: string | null;
  stopCondition?: string | null;
  budget?: string | null;
  lastVerification?: string | null;
};

export class InvalidGoalStatusError extends Error {
  constructor(status: string) {
    super(`Invalid goal status: ${status}`);
    this.name = 'InvalidGoalStatusError';
  }
}

export class AmbiguousActiveGoalsError extends Error {
  constructor(goals: Array<{ id: string; objective: string }>) {
    const listing = goals.map((goal) => `"${goal.objective}" (${goal.id})`).join(', ');
    super(`Multiple active goals: ${listing}. Pass goal_id to choose.`);
    this.name = 'AmbiguousActiveGoalsError';
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

export async function createGoal(db: DbClient, input: NewGoal): Promise<Goal> {
  const status = input.status ?? 'active';
  assertGoalStatus(status);
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(goals)
    .values({
      id,
      projectId: input.projectId,
      objective: input.objective,
      name: input.name ?? null,
      status,
      verificationSurface: input.verificationSurface ?? null,
      constraints: input.constraints ?? null,
      boundaries: input.boundaries ?? null,
      iterationPolicy: input.iterationPolicy ?? null,
      stopCondition: input.stopCondition ?? null,
      budget: input.budget ?? null,
      lastVerification: input.lastVerification ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create goal');
  }
  if (status === 'active') {
    await db
      .update(projects)
      .set({ currentGoalId: id, updatedAt: now })
      .where(eq(projects.id, input.projectId))
      .run();
  }
  return row;
}

export async function getGoal(db: DbClient, id: string): Promise<Goal | undefined> {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

export async function listGoals(db: DbClient, projectId: string): Promise<Goal[]> {
  return db
    .select()
    .from(goals)
    .where(eq(goals.projectId, projectId))
    .orderBy(asc(goals.createdAt), asc(goals.id))
    .all();
}

export async function updateGoal(
  db: DbClient,
  id: string,
  input: GoalUpdate,
): Promise<Goal | undefined> {
  if (input.status !== undefined) {
    assertGoalStatus(input.status);
  }
  const now = new Date();
  const rows = await db
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

export async function updateGoalStatus(
  db: DbClient,
  id: string,
  status: GoalStatus,
): Promise<Goal | undefined> {
  return updateGoal(db, id, { status });
}

export async function getOrCreateDefaultGoal(db: DbClient, projectId: string): Promise<Goal> {
  const existing = await db
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

/** Resolves where new work should land: active goals only; never complete/paused/blocked. */
export async function resolveGoalForNewWork(db: DbClient, projectId: string): Promise<Goal> {
  const active = await db
    .select()
    .from(goals)
    .where(eq(goals.projectId, projectId))
    .orderBy(asc(goals.createdAt), asc(goals.id))
    .all();
  const activeGoals = active.filter((goal) => goal.status === 'active');
  const [soleActiveGoal] = activeGoals;
  if (activeGoals.length === 1 && soleActiveGoal !== undefined) {
    return soleActiveGoal;
  }
  if (activeGoals.length === 0) {
    return createGoal(db, {
      projectId,
      objective: 'General',
      status: 'active',
    });
  }
  throw new AmbiguousActiveGoalsError(
    activeGoals.map((goal) => ({ id: goal.id, objective: goal.objective })),
  );
}

export async function deleteGoalsByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(goals).where(eq(goals.projectId, projectId)).run();
  return result.rowsAffected;
}
