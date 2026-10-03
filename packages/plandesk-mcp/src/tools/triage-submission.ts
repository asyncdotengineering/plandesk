import type { SyncService } from '@plandesk/api';
import { InvalidTriageError, InvalidTriageInputError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createTriageSubmissionHandler(
  syncService: SyncService,
): (args: {
  submission_id: string;
  action: 'accept' | 'reject';
  as_task?: { label?: string; description?: string };
  link_task_id?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    const submission = await syncService.getSubmission(args.submission_id);
    if (submission === undefined) {
      return toolNotFound();
    }

    try {
      const result = await syncService.triage(
        args.submission_id,
        args.action,
        args.as_task,
        args.link_task_id,
      );
      return toolSuccess('submission', result);
    } catch (error) {
      if (error instanceof InvalidTriageInputError) {
        return toolInvalidArgument(error.message);
      }
      if (error instanceof InvalidTriageError) {
        return toolNotFound();
      }
      throw error;
    }
  };
}
