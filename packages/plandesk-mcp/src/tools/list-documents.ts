import type { DocumentService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListDocumentsHandler(
  documentService: DocumentService,
): (args: { project_id: string }) => ToolResult {
  return ({ project_id }) => {
    const documents = documentService.listTree(project_id);
    if (!documents) {
      return toolNotFound();
    }
    return toolSuccess('documents', documents);
  };
}
