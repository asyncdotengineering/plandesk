import type { CommentService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListArtifactCommentsHandler(
  commentService: CommentService,
): (args: { project_id: string; artifact_id: string; include_resolved?: boolean }) => Promise<ToolResult> {
  return async (args) => {
    const includeResolved = args.include_resolved ?? false;
    const comments = await commentService.listForArtifact(args.project_id, args.artifact_id, {
      includeResolved,
    });
    if (!comments) {
      return toolNotFound();
    }
    return toolSuccess('comments', comments);
  };
}
