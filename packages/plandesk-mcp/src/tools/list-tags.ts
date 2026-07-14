import type { TagService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListTagsHandler(
  tagService: TagService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async ({ project_id }) => {
    const tags = await tagService.list(project_id);
    if (!tags) {
      return toolNotFound();
    }
    return toolSuccess('tags', tags);
  };
}
