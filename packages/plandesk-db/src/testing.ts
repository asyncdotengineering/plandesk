import type { DbClient } from './client.js';
import { asc, eq } from 'drizzle-orm';
import { createGoal, type Goal } from './repositories/goals.js';
import {
  createProject,
  listProjects,
  type NewProject,
  type Project,
} from './repositories/projects.js';
import { createTask, type NewTask, type Task } from './repositories/tasks.js';
import { DEFAULT_ORG_ID, DEFAULT_WORKSPACE_ID, goals } from './schema.js';

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
