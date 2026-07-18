import type { SyncService } from '@plandesk/api';
import type { ShareSubmissionStatus } from '@plandesk/db';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListSubmissionsHandler(
  syncService: SyncService,
  projectExists: (projectId: string) => boolean | Promise<boolean>,
): (args: { project_id: string; status?: ShareSubmissionStatus }) => Promise<ToolResult> {
  return async (args) => {
    if (!(await projectExists(args.project_id))) {
      return toolNotFound();
    }
    const submissions = await syncService.listTriage(args.project_id, args.status);
    if (submissions === undefined) {
      return toolNotFound();
    }
    return toolSuccess('submissions', submissions);
  };
}
