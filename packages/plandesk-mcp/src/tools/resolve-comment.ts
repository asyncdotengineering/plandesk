import type { CommentService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createResolveCommentHandler(
  commentService: CommentService,
): (args: { comment_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const comment = await commentService.update(args.comment_id, { resolved: true });
    if (!comment) {
      return toolNotFound();
    }
    return toolSuccess('comment', comment);
  };
}
