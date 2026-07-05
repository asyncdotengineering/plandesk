import type { CommentService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListCommentsHandler(
  commentService: CommentService,
): (args: {
  project_id: string;
  target_type?: 'document' | 'task' | 'note';
  target_id?: string;
  include_resolved?: boolean;
}) => ToolResult {
  return (args) => {
    const includeResolved = args.include_resolved ?? false;

    if (args.target_type !== undefined || args.target_id !== undefined) {
      if (args.target_type === undefined || args.target_id === undefined) {
        return toolInvalidArgument();
      }

      const targetProjectId = commentService.resolveTargetProjectId({
        type: args.target_type,
        id: args.target_id,
      });
      if (!targetProjectId) {
        return toolNotFound();
      }
      if (targetProjectId !== args.project_id) {
        return toolInvalidArgument();
      }

      const comments = commentService.listByTarget(
        { type: args.target_type, id: args.target_id },
        { includeResolved },
      );
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
