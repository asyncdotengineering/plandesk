import type { GoalService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string }) => ToolResult {
  return (args) => {
    const goal = goalService.get(args.goal_id);
    if (!goal) {
      return toolNotFound();
    }
    return toolSuccess('goal', goal);
  };
}