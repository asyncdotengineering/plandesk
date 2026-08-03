import type { ProjectService } from '@plandesk/api';
import { isValidRegisteredRepoRoot } from '@plandesk/db';
import type { WorkspaceRootsResolver } from './file-path.js';

/** Registered absolute repo roots for projects visible in this session. */
export function createWorkspaceRootsResolver(
  projectService: Pick<ProjectService, 'list'>,
): WorkspaceRootsResolver {
  return async () => {
    const projects = await projectService.list();
    return projects
      .map((project) => project.folder_path)
      .filter((path): path is string => path !== null && isValidRegisteredRepoRoot(path));
  };
}
