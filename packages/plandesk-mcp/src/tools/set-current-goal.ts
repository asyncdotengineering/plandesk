import { InvalidGoalTransitionError, type GoalService } from '@plandesk/api';
import {
  toolInvalidArgument,
  toolNotFound,
  toolSuccessPayload,
  type ToolResult,
} from './result.js';

export function createSetCurrentGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string }) => Promise<ToolResult> {
  return async ({ goal_id }) => {
    try {
      const result = await goalService.setCurrent(goal_id);
      if (!result) {
        return toolNotFound();
      }
      return toolSuccessPayload(result);
    } catch (error) {
      if (error instanceof InvalidGoalTransitionError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
