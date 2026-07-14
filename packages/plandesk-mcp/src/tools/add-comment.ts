import type { CommentService } from '@plandesk/api';
import { InvalidCommentError } from '@plandesk/api';
import type { CommentTargetType } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createAddCommentHandler(
  commentService: CommentService,
): (args: {
  target_type: CommentTargetType;
  target_id: string;
  body: string;
  passage?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const comment = await commentService.create(
        { type: args.target_type, id: args.target_id },
        {
          body: args.body,
          passage: args.passage,
        },
      );
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
