import type { DocumentService } from '@plandesk/api';
import { InvalidDocumentError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateDocumentHandler(
  documentService: DocumentService,
): (args: {
  document_id: string;
  title?: string;
  body?: string;
  status_line?: string;
}) => ToolResult {
  return (args) => {
    try {
      const document = documentService.update(args.document_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.status_line !== undefined ? { statusLine: args.status_line } : {}),
      });
      if (!document) {
        return toolNotFound();
      }
      return toolSuccess('document', document);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}
