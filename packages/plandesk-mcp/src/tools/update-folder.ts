import type { FolderService } from '@plandesk/api';
import { InvalidFolderError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateFolderHandler(
  folderService: FolderService,
): (args: { folder_id: string; name?: string; parent_folder_id?: string | null }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const folder = await folderService.update(args.folder_id, {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.parent_folder_id !== undefined
          ? { parentFolderId: args.parent_folder_id }
          : {}),
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
