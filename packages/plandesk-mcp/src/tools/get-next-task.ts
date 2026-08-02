import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetNextTaskHandler(
  taskService: TaskService,
): (
  args: { project_id: string; goal_id?: string; goal?: string; tags?: string[]; verbose?: boolean },
) => Promise<ToolResult> {
  return async (args) => {
    const filter: { goalId?: string; goalName?: string; tags?: string[] } = {};
    if (args.goal_id !== undefined) {
      filter.goalId = args.goal_id;
    }
    if (args.goal !== undefined) {
      filter.goalName = args.goal;
    }
    if (args.tags !== undefined) {
      filter.tags = args.tags;
    }
    const result = await taskService.nextActionable(args.project_id, {
      ...filter,
      ...(args.verbose !== undefined ? { verbose: args.verbose } : {}),
    });
    if (!result) {
      return toolNotFound();
    }
    return toolSuccess('next', result);
  };
}
