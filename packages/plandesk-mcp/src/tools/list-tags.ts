import type { TagService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListTagsHandler(
  tagService: TagService,
): (args: { project_id: string }) => ToolResult {
  return ({ project_id }) => {
    const tags = tagService.list(project_id);
    if (!tags) {
      return toolNotFound();
    }
    return toolSuccess('tags', tags);
  };
}
