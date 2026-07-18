import type { DbClient } from './client.js';
import { getOrCreateDefaultGoal } from './repositories/goals.js';
import {
  createProject,
  listProjects,
  type NewProject,
  type Project,
} from './repositories/projects.js';
import { createTask, type NewTask, type Task } from './repositories/tasks.js';
import { DEFAULT_ORG_ID, DEFAULT_WORKSPACE_ID } from './schema.js';

export async function createTaskWithDefaultGoal(
  db: DbClient,
  input: Omit<NewTask, 'goalId'> & { goalId?: string },
): Promise<Task> {
  const goalId = input.goalId ?? (await getOrCreateDefaultGoal(db, input.projectId)).id;
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
