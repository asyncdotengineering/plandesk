import { DuplicateGoalNameError, InvalidVerificationSurfaceError, type GoalService } from '@plandesk/api';
import {
  toolInvalidArgument,
  toolNotFound,
  toolSuccessPayload,
  type ToolResult,
} from './result.js';

export function createUpdateGoalHandler(
  goalService: GoalService,
): (args: {
  goal_id: string;
  name?: string | null;
  objective?: string;
  verification_surface?: string;
  constraints?: string;
  boundaries?: string;
  iteration_policy?: string;
  stop_condition?: string;
  budget?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const goal = await goalService.update(args.goal_id, {
        ...(args.objective !== undefined ? { objective: args.objective } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.verification_surface !== undefined
          ? { verificationSurface: args.verification_surface }
          : {}),
        ...(args.constraints !== undefined ? { constraints: args.constraints } : {}),
        ...(args.boundaries !== undefined ? { boundaries: args.boundaries } : {}),
        ...(args.iteration_policy !== undefined ? { iterationPolicy: args.iteration_policy } : {}),
        ...(args.stop_condition !== undefined ? { stopCondition: args.stop_condition } : {}),
        ...(args.budget !== undefined ? { budget: args.budget } : {}),
      });
      if (!goal) {
        return toolNotFound();
      }
      return toolSuccessPayload({
        goal,
        warnings: goal.verification_surface === null ? ['verification_surface is null'] : [],
      });
    } catch (error) {
      if (error instanceof InvalidVerificationSurfaceError || error instanceof DuplicateGoalNameError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
