import type { ProjectService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateProjectHandler(
  projectService: ProjectService,
): (args: {
  project_id: string;
  name?: string;
  description?: string | null;
  repo_url?: string | null;
  folder_path?: string | null;
}) => Promise<ToolResult> {
  return async (args) => {
    const project = await projectService.update(args.project_id, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.repo_url !== undefined ? { repoUrl: args.repo_url } : {}),
      ...(args.folder_path !== undefined ? { folderPath: args.folder_path } : {}),
    });
    if (!project) {
      return toolNotFound();
    }
    return toolSuccess('project', project);
  };
}
