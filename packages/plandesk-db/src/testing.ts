import type { DbClient } from './client.js';
import { getOrCreateDefaultGoal } from './repositories/goals.js';
import { ensureDefaultOrg } from './repositories/orgs.js';
import {
  createProject,
  listProjects,
  type NewProject,
  type Project,
} from './repositories/projects.js';
import { createTask, type NewTask, type Task } from './repositories/tasks.js';
import { createToken, type CreateTokenResult } from './repositories/tokens.js';
import type { TokenScope } from './schema.js';

export async function createTaskWithDefaultGoal(
  db: DbClient,
  input: Omit<NewTask, 'goalId'> & { goalId?: string },
): Promise<Task> {
  const goalId = input.goalId ?? (await getOrCreateDefaultGoal(db, input.projectId)).id;
  return createTask(db, { ...input, goalId });
}

/** Ensures the default org exists and creates a project in it. For tests. */
export async function createProjectInDefaultOrg(
  db: DbClient,
  input: Omit<NewProject, 'orgId'> & { orgId?: string },
): Promise<Project> {
  const orgId = input.orgId ?? (await ensureDefaultOrg(db)).id;
  return createProject(db, { ...input, orgId });
}

/** Ensures the default org exists and mints a token for it. For tests. */
export async function createTokenInDefaultOrg(
  db: DbClient,
  input: { name: string; orgId?: string; scope?: TokenScope },
): Promise<CreateTokenResult> {
  const orgId = input.orgId ?? (await ensureDefaultOrg(db)).id;
  return createToken(db, { name: input.name, orgId, scope: input.scope });
}

/** Lists projects in the default org. For tests. */
export async function listProjectsInDefaultOrg(
  db: DbClient,
  options?: Parameters<typeof listProjects>[2],
): Promise<Project[]> {
  const org = await ensureDefaultOrg(db);
  return listProjects(db, org.id, options);
}
