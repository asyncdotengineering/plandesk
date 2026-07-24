import type { DocumentService } from '@plandesk/api';
import { InvalidDocumentError } from '@plandesk/api';
import { ensureHtmlBody } from './markdown.js';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateDocumentHandler(
  documentService: DocumentService,
): (args: {
  document_id: string;
  title?: string;
  body?: string;
  status_line?: string;
  linked_task_id?: string | null;
  folder_id?: string | null;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const document = await documentService.update(args.document_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: ensureHtmlBody(args.body) } : {}),
        ...(args.status_line !== undefined ? { statusLine: args.status_line } : {}),
        ...(args.linked_task_id !== undefined ? { linkedTaskId: args.linked_task_id } : {}),
        ...(args.folder_id !== undefined ? { folderId: args.folder_id } : {}),
      });
      if (!document) {
        return toolNotFound();
      }
      return toolSuccess('document', document);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
