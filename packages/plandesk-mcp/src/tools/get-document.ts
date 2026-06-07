import type { DocumentService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetDocumentHandler(
  documentService: DocumentService,
): (args: { document_id: string }) => ToolResult {
  return ({ document_id }) => {
    const document = documentService.get(document_id);
    if (!document) {
      return toolNotFound();
    }
    return toolSuccess('document', document);
  };
}
