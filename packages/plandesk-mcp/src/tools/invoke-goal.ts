import type { GoalService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

export function createInvokeGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string }) => Promise<ToolResult> {
  return async ({ goal_id }) => {
    const result = await goalService.invoke(goal_id);
    if (!result) {
      return toolNotFound();
    }
    if (!result.ok) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }
    return toolSuccessPayload(result);
  };
}
