import type { CommentService } from '@plandesk/api';
import { InvalidCommentError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createAddCommentHandler(
  commentService: CommentService,
): (args: { document_id: string; body: string; passage?: string }) => ToolResult {
  return (args) => {
    try {
      const comment = commentService.create(args.document_id, {
        body: args.body,
        passage: args.passage,
      });
      if (!comment) {
        return toolNotFound();
      }
      return toolSuccess('comment', comment);
    } catch (error) {
      if (error instanceof InvalidCommentError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}
