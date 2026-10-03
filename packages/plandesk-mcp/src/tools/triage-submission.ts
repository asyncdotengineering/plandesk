import type { TriageService } from '@plandesk/api';
import { InvalidTriageError } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createTriageSubmissionHandler(
  triageService: TriageService,
): (args: {
  submission_id: string;
  action: 'accept' | 'reject';
  as_task?: { label?: string; description?: string };
  link_task_id?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    const submission = await triageService.getSubmission(args.submission_id);
    if (submission === undefined) {
      return toolNotFound();
    }

    try {
      const result = await triageService.triage(
        args.submission_id,
        args.action,
        args.as_task,
        args.link_task_id,
      );
      return toolSuccess('submission', result);
    } catch (error) {
      if (error instanceof InvalidTriageError) {
        return toolNotFound();
      }
      throw error;
    }
  };
}
