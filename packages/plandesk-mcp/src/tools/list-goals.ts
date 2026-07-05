import type { GoalService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListGoalsHandler(
  goalService: GoalService,
): (args: { project_id: string }) => ToolResult {
  return (args) => {
    const goals = goalService.listByProject(args.project_id);
    if (!goals) {
      return toolNotFound();
    }
    return toolSuccess('goals', goals);
  };
}