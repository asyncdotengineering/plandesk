import { getProjectInOrg, type DbClient, type Project } from '@plandesk/db';

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
  return project;
}
