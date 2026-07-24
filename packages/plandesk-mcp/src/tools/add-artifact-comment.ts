import type { CommentService } from '@plandesk/api';
import { InvalidCommentError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createAddArtifactCommentHandler(
  commentService: CommentService,
): (args: {
  project_id: string;
  artifact_id: string;
  body: string;
  passage?: string;
  anchor?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const comment = await commentService.createForArtifact(args.project_id, args.artifact_id, {
        body: args.body,
        passage: args.passage,
        anchor: args.anchor,
      });
      if (!comment) {
        return toolNotFound();
      }
      return toolSuccess('comment', comment);
    } catch (error) {
      if (error instanceof InvalidCommentError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
