import type { FolderService } from '@plandesk/api';
import { InvalidFolderError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateFolderHandler(
  folderService: FolderService,
): (args: { project_id: string; name: string; parent_folder_id?: string }) => ToolResult {
  return (args) => {
    try {
      const folder = folderService.create(args.project_id, {
        name: args.name,
        ...(args.parent_folder_id !== undefined ? { parentFolderId: args.parent_folder_id } : {}),
      });
      if (!folder) {
        return toolNotFound();
      }
      return toolSuccess('folder', folder);
    } catch (error) {
      if (error instanceof InvalidFolderError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
