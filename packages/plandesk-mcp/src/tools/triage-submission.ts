import type { SyncService } from '@plandesk/api';
import { InvalidTriageError, SyncUnavailableError, SyncUnauthorizedError } from '@plandesk/api';
import type { TaskStatus } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createTriageSubmissionHandler(
  syncService: SyncService,
): (args: {
  submission_id: string;
  action: 'accept' | 'reject';
  as_task?: { label?: string; status?: TaskStatus; description?: string };
}) => Promise<ToolResult> {
  return async (args) => {
    const submission = syncService.getSubmission(args.submission_id);
    if (submission === undefined) {
      return toolNotFound();
    }

    const remote = syncService.getRemote(submission.project_id);
    if (remote === undefined) {
      return toolInvalidArgument('not published — run publish_project');
    }

    try {
      const result = await syncService.triage(
        args.submission_id,
        args.action,
        remote,
        args.as_task,
      );
      return toolSuccess('submission', result);
    } catch (error) {
      if (error instanceof InvalidTriageError) {
        return toolNotFound();
      }
      if (error instanceof SyncUnauthorizedError) {
        return toolInvalidArgument('sync token unauthorized');
      }
      if (error instanceof SyncUnavailableError) {
        return toolInvalidArgument('sync server unavailable');
      }
      throw error;
    }
  };
}
