import type { CommentService, DocumentService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListCommentsHandler(
  commentService: CommentService,
  documentService: DocumentService,
): (args: { project_id: string; document_id?: string; include_resolved?: boolean }) => ToolResult {
  return (args) => {
    const includeResolved = args.include_resolved ?? false;

    if (args.document_id !== undefined) {
      const document = documentService.get(args.document_id);
      if (!document) {
        return toolNotFound();
      }
      if (document.project_id !== args.project_id) {
        return toolInvalidArgument();
      }
      const comments = commentService.listByDocument(args.document_id, { includeResolved });
      if (!comments) {
        return toolNotFound();
      }
      return toolSuccess('comments', comments);
    }

    const comments = commentService.listByProject(args.project_id, { includeResolved });
    if (!comments) {
      return toolNotFound();
    }
    return toolSuccess('comments', comments);
  };
}
