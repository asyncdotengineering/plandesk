import { InvalidOverviewDocumentError, type ProjectService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateProjectHandler(
  projectService: ProjectService,
): (args: {
  project_id: string;
  name?: string;
  description?: string | null;
  owner_id?: string | null;
  overview_document_id?: string | null;
  repo_url?: string | null;
  folder_path?: string | null;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const project = await projectService.update(args.project_id, {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.owner_id !== undefined ? { ownerId: args.owner_id } : {}),
        ...(args.overview_document_id !== undefined
          ? { overviewDocumentId: args.overview_document_id }
          : {}),
        ...(args.repo_url !== undefined ? { repoUrl: args.repo_url } : {}),
        ...(args.folder_path !== undefined ? { folderPath: args.folder_path } : {}),
      });
      if (!project) {
        return toolNotFound();
      }
      return toolSuccess('project', project);
    } catch (error) {
      if (error instanceof InvalidOverviewDocumentError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
