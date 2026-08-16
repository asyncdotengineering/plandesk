import type { FolderService } from '@plandesk/api';
import { InvalidFolderError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export type DeleteFolderArgs = {
  folder_id: string;
  /**
   * Destination for the folder's documents and sub-folders.
   * - omit → deleted folder's parent (or Unfiled when it was at the project root)
   * - null → Unfiled
   * - uuid → that folder (must be in-project and not under the deleted folder)
   */
  reparent_to?: string | null;
};

/**
 * Delete a folder without orphaning contents. Default reparent target is the
 * deleted folder's parent (null == Unfiled). See reparent_to for overrides.
 */
export function createDeleteFolderHandler(
  folderService: FolderService,
): (args: DeleteFolderArgs) => Promise<ToolResult> {
  return async (args) => {
    try {
      const options = args.reparent_to !== undefined ? { reparentTo: args.reparent_to } : undefined;
      const deleted = await folderService.delete(args.folder_id, options);
      if (!deleted) {
        return toolNotFound();
      }
      return toolSuccess('deleted', true);
    } catch (error) {
      if (error instanceof InvalidFolderError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
