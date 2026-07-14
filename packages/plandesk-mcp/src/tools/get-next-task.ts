import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetNextTaskHandler(
  taskService: TaskService,
): (args: { project_id: string; goal_id?: string; tags?: string[] }) => Promise<ToolResult> {
  return async (args) => {
    const filter: { goalId?: string; tags?: string[] } = {};
    if (args.goal_id !== undefined) {
      filter.goalId = args.goal_id;
    }
    if (args.tags !== undefined) {
      filter.tags = args.tags;
    }
    const result = await taskService.nextActionable(args.project_id, filter);
    if (!result) {
      return toolNotFound();
    }
    return toolSuccess('next', result);
  };
}
