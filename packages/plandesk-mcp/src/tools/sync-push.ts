import type { SyncService } from '@plandesk/api';
import { SyncUnavailableError, SyncUnauthorizedError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, type ToolResult } from './result.js';

export function createSyncPushHandler(
  syncService: SyncService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const remote = syncService.getRemote(args.project_id);
    if (remote === undefined) {
      return toolInvalidArgument('not published — run publish_project');
    }

    try {
      const { pushed } = await syncService.push(args.project_id, remote);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ pushed }) }],
        structuredContent: { pushed },
      };
    } catch (error) {
      if (error instanceof SyncUnauthorizedError) {
        return toolInvalidArgument('sync token unauthorized');
      }
      if (error instanceof SyncUnavailableError) {
        if (error.message.includes('project not found')) {
          return toolNotFound();
        }
        return toolInvalidArgument('sync server unavailable');
      }
      throw error;
    }
  };
}
