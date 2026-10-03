import type { DocumentService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

export type MoveDocumentsArgs = {
  document_ids: string[];
  folder_id: string | null;
};

/**
 * Bulk move. Per-item results (not atomic): each document_id is attempted
 * independently. Failures for missing/foreign/invalid folder assignments are
 * reported in `failed` without rolling back successful moves.
 */
export function createMoveDocumentsHandler(
  documentService: DocumentService,
): (args: MoveDocumentsArgs) => Promise<ToolResult> {
  return async ({ document_ids, folder_id }) => {
    const result = await documentService.moveMany(document_ids, folder_id);
    // Empty moved + only failures → same signal as update_document on a
    // missing/foreign id (isolation sweeps require isError).
    if (result.moved.length === 0) {
      return toolNotFound();
    }
    return toolSuccessPayload({
      moved: result.moved,
      failed: result.failed,
    });
  };
}
