import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetNextTaskHandler(
  taskService: TaskService,
): (args: { project_id: string; tags?: string[] }) => ToolResult {
  return (args) => {
    const result = taskService.nextActionable(
      args.project_id,
      args.tags !== undefined ? { tags: args.tags } : {},
    );
    if (!result) {
      return toolNotFound();
    }
    return toolSuccess('next', result);
  };
}
