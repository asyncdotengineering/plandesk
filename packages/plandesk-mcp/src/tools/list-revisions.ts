import { InvalidRevisionQueryError, type RevisionService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListRevisionsHandler(
  revisionService: RevisionService,
): (args: {
  project_id: string;
  target_type: 'task' | 'document';
  target_id: string;
}) => Promise<ToolResult> {
  return async ({ project_id, target_type, target_id }) => {
    try {
      const revisions = await revisionService.list(project_id, target_type, target_id);
      if (!revisions) {
        return toolNotFound();
      }
      return toolSuccess('revisions', revisions);
    } catch (error) {
      if (error instanceof InvalidRevisionQueryError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
