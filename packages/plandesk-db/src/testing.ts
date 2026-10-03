import type { DbClient } from './client.js';
import { and, asc, eq, isNull } from 'drizzle-orm';
export { findSqld, startSqld } from './testing/sqld.js';
import { createGoal, type Goal } from './repositories/goals.js';
import type { PrototypeLink } from './repositories/prototype-links.js';
import {
  createProject,
  listProjects,
  type NewProject,
  type Project,
} from './repositories/projects.js';
import { createTask, type NewTask, type Task } from './repositories/tasks.js';
import {
  DEFAULT_ORG_ID,
  DEFAULT_WORKSPACE_ID,
  goals,
  guestSessions,
  prototypeLinks,
  renderTokens,
  shareSubmissions,
  type ShareSubmissionStatus,
} from './schema.js';

/**
 * The project's oldest goal, created as 'General' when it has none. A test
 * fixture only: production leaves goal-less work with no goal.
 */
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

export async function createTaskWithDefaultGoal(
  db: DbClient,
  input: Omit<NewTask, 'goalId'> & { goalId?: string | null },
): Promise<Task> {
  const goalId =
    input.goalId !== undefined
      ? input.goalId
      : (await getOrCreateDefaultGoal(db, input.projectId)).id;
  return createTask(db, { ...input, goalId });
}

/** Creates a project under DEFAULT_ORG_ID (or an explicit orgId). For tests. */
export async function createProjectInDefaultOrg(
  db: DbClient,
  input: Omit<NewProject, 'orgId' | 'workspaceId'> & { orgId?: string; workspaceId?: string },
): Promise<Project> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  return createProject(db, { ...input, orgId, workspaceId });
}

/** Lists projects in the default org. For tests. */
export async function listProjectsInDefaultOrg(
  db: DbClient,
  options?: Parameters<typeof listProjects>[2],
): Promise<Project[]> {
  return listProjects(db, DEFAULT_ORG_ID, options);
}

export type UpsertSubmissionInput = {
  id: string;
  projectId: string;
  hostedShareId: string;
  participantName: string;
  title: string;
  body?: string | null;
  severity?: string | null;
  taskRef?: string | null;
  status?: ShareSubmissionStatus;
  createdAt: Date;
  pulledAt: Date;
};

/** Insert a submission row with fixed ids and stamps; no-op when the id exists. */
export async function upsertSubmission(
  db: DbClient,
  input: UpsertSubmissionInput,
): Promise<boolean> {
  const result = await db
    .insert(shareSubmissions)
    .values({
      id: input.id,
      projectId: input.projectId,
      hostedShareId: input.hostedShareId,
      participantName: input.participantName,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? null,
      taskRef: input.taskRef ?? null,
      status: input.status ?? 'pending',
      createdAt: input.createdAt,
      pulledAt: input.pulledAt,
    })
    .onConflictDoNothing()
    .run();

  return result.rowsAffected > 0;
}

export async function revokeGuestSession(db: DbClient, id: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(guestSessions)
    .set({ revokedAt: now })
    .where(and(eq(guestSessions.id, id), isNull(guestSessions.revokedAt)))
    .returning()
    .all();
  return rows.length > 0;
}

export async function revokeRenderToken(db: DbClient, id: string): Promise<void> {
  await db.update(renderTokens).set({ revokedAt: new Date() }).where(eq(renderTokens.id, id)).run();
}

export async function listPrototypeLinksByFromArtifact(
  db: DbClient,
  fromArtifactId: string,
): Promise<PrototypeLink[]> {
  return db
    .select()
    .from(prototypeLinks)
    .where(eq(prototypeLinks.fromArtifactId, fromArtifactId))
    .all();
}
