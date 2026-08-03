import type { SearchService } from '@plandesk/api';
import { toolSuccessPayload, type ToolResult } from './result.js';

export function createSearchHandler(
  searchService: SearchService,
): (args: {
  query: string;
  project_id?: string;
  workspace_id?: string;
  limit?: number;
}) => Promise<ToolResult> {
  return async ({ query, project_id, workspace_id, limit }) => {
    const result = await searchService.search({
      query,
      ...(project_id !== undefined ? { projectId: project_id } : {}),
      ...(workspace_id !== undefined ? { workspaceId: workspace_id } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return toolSuccessPayload(result);
  };
}
