import { InvalidGoalStatusError, type GoalStatus } from '@plandesk/db';
import { type GoalService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateGoalHandler(
  goalService: GoalService,
): (args: {
  project_id: string;
  objective: string;
  verification_surface?: string;
  constraints?: string;
  boundaries?: string;
  iteration_policy?: string;
  stop_condition?: string;
  budget?: string;
  status?: string;
}) => ToolResult {
  return (args) => {
    try {
      const goal = goalService.create(args.project_id, {
        objective: args.objective,
        ...(args.verification_surface !== undefined
          ? { verificationSurface: args.verification_surface }
          : {}),
        ...(args.constraints !== undefined ? { constraints: args.constraints } : {}),
        ...(args.boundaries !== undefined ? { boundaries: args.boundaries } : {}),
        ...(args.iteration_policy !== undefined
          ? { iterationPolicy: args.iteration_policy }
          : {}),
        ...(args.stop_condition !== undefined ? { stopCondition: args.stop_condition } : {}),
        ...(args.budget !== undefined ? { budget: args.budget } : {}),
        ...(args.status !== undefined ? { status: args.status as GoalStatus } : {}),
      });
      if (!goal) {
        return toolNotFound();
      }
      return toolSuccess('goal', goal);
    } catch (error) {
      if (error instanceof InvalidGoalStatusError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}