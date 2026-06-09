import type { SyncService } from '@plandesk/api';
import { SyncUnavailableError, SyncUnauthorizedError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, type ToolResult } from './result.js';

export function createPublishProjectHandler(
  syncService: SyncService,
): (args: { project_id: string; server_url: string; sync_token: string }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const { globalProjectId, pushed } = await syncService.publishProject(args.project_id, {
        serverUrl: args.server_url,
        syncToken: args.sync_token,
      });
      syncService.setRemote(args.project_id, {
        serverUrl: args.server_url,
        globalProjectId,
        syncToken: args.sync_token,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ global_project_id: globalProjectId, pushed }),
          },
        ],
        structuredContent: { global_project_id: globalProjectId, pushed },
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
