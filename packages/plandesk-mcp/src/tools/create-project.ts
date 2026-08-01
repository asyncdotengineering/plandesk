import { InvalidOverviewDocumentError, type ProjectService } from '@plandesk/api';
import { toolInvalidArgument, toolSuccess, type ToolResult } from './result.js';

export function createCreateProjectHandler(
  projectService: ProjectService,
): (args: {
  name: string;
  description?: string;
  owner_id?: string | null;
  overview_document_id?: string | null;
  repo_url?: string | null;
  folder_path?: string | null;
}) => Promise<ToolResult> {
  return async (args) => {
    if (args.name.trim() === '') {
      return toolInvalidArgument('name must not be blank');
    }
    try {
      const project = await projectService.create({
        name: args.name,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.owner_id !== undefined ? { ownerId: args.owner_id } : {}),
        ...(args.overview_document_id !== undefined
          ? { overviewDocumentId: args.overview_document_id }
          : {}),
        ...(args.repo_url !== undefined ? { repoUrl: args.repo_url } : {}),
        ...(args.folder_path !== undefined ? { folderPath: args.folder_path } : {}),
      });
      return toolSuccess('project', project);
    } catch (error) {
      if (error instanceof InvalidOverviewDocumentError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
