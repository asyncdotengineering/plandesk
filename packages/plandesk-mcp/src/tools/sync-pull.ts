import type { SyncService } from '@plandesk/api';
import { SyncUnavailableError, SyncUnauthorizedError } from '@plandesk/api';
import { toolInvalidArgument, type ToolResult } from './result.js';

export function createSyncPullHandler(
  syncService: SyncService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const remote = await syncService.getRemote(args.project_id);
    if (remote === undefined) {
      return toolInvalidArgument('not published — run publish_project');
    }

    try {
      const { pulled } = await syncService.pull(args.project_id, remote);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ pulled }) }],
        structuredContent: { pulled },
      };
    } catch (error) {
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
