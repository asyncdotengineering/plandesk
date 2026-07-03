import type { DocumentService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

export function createListDocumentsHandler(
  documentService: DocumentService,
): (args: { project_id: string; folder_id?: string }) => ToolResult {
  return ({ project_id, folder_id }) => {
    if (folder_id !== undefined) {
      const documents = documentService.listByFolder(project_id, folder_id);
      if (!documents) {
        return toolNotFound();
      }
      return toolSuccessPayload({ documents });
    }

    const tree = documentService.listFolderTree(project_id);
    if (!tree) {
      return toolNotFound();
    }
    return toolSuccessPayload({ documents: tree.documents, folders: tree.folders });
  };
}
