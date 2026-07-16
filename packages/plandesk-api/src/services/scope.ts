import { getProjectInOrg, type DbClient, type Project } from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';

/** Thrown when a project is missing or belongs to another org. Maps to HTTP 404. */
export class ProjectNotInOrgError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotInOrgError';
  }
}

/**
 * Fail-closed tenant boundary: project must exist and belong to orgId.
 * Returns 404-shaped error (not 403) so existence is not leaked across orgs.
 * BA5: agent keys may also carry projectId — wrong project is the same 404.
 */
export async function assertProjectInOrg(
  db: DbClient,
  projectId: string,
  orgId: string,
): Promise<Project> {
  const project = await getProjectInOrg(db, projectId, orgId);
  if (!project) {
    throw new ProjectNotInOrgError(projectId);
  }
  const ctx = tryGetAuthContext();
  if (
    ctx !== undefined &&
    ctx.kind === 'apikey' &&
    ctx.projectId !== undefined &&
    ctx.projectId !== projectId
  ) {
    throw new ProjectNotInOrgError(projectId);
  }
  return project;
}
