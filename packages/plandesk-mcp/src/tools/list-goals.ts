import type { GoalService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListGoalsHandler(
  goalService: GoalService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const goals = await goalService.listByProject(args.project_id);
    if (!goals) {
      return toolNotFound();
    }
    return toolSuccess('goals', goals);
  };
}
