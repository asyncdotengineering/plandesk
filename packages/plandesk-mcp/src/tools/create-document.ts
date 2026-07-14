import type { DocumentService } from '@plandesk/api';
import { InvalidDocumentError } from '@plandesk/api';
import { ensureHtmlBody } from './markdown.js';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateDocumentHandler(
  documentService: DocumentService,
): (args: {
  project_id: string;
  title: string;
  body?: string;
  linked_task_id?: string;
  parent_id?: string;
  folder_id?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const document = await documentService.create(args.project_id, {
        title: args.title,
        ...(args.body !== undefined ? { body: ensureHtmlBody(args.body) } : {}),
        ...(args.linked_task_id !== undefined ? { linkedTaskId: args.linked_task_id } : {}),
        ...(args.parent_id !== undefined ? { parentId: args.parent_id } : {}),
        ...(args.folder_id !== undefined ? { folderId: args.folder_id } : {}),
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
