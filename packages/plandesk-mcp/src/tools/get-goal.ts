import type { GoalService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string; verbose?: boolean }) => Promise<ToolResult> {
  return async (args) => {
    const goal = await goalService.get(args.goal_id);
    if (!goal) {
      return toolNotFound();
    }
    if (args.verbose) {
      return toolSuccess('goal', goal);
    }
    return toolSuccess('goal', {
      ...goal,
      cycle_tasks: goal.cycle_tasks.map((task) => {
        const { description, ...summary } = task;
        void description;
        return summary;
      }),
    });
  };
}
