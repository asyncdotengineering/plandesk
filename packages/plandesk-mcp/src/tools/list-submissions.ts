import type { SyncService } from '@plandesk/api';
import type { ShareSubmissionStatus } from '@plandesk/db';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListSubmissionsHandler(
  syncService: SyncService,
  projectExists: (projectId: string) => boolean,
): (args: { project_id: string; status?: ShareSubmissionStatus }) => ToolResult {
  return (args) => {
    if (!projectExists(args.project_id)) {
      return toolNotFound();
    }
    const submissions = syncService.listTriage(args.project_id, args.status);
    return toolSuccess('submissions', submissions);
  };
}
