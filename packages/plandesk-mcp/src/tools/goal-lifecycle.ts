import {
  GoalCompletionBlockedError,
  GoalVerificationRequiredError,
  InvalidGoalTransitionError,
  InvalidVerificationSurfaceError,
  type GoalService,
  type VerificationEvidence,
} from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

async function handleLifecycle(
  goalService: GoalService,
  goalId: string,
  action: 'pause' | 'resume' | 'complete',
  evidence?: VerificationEvidence,
): Promise<ToolResult> {
  try {
    const goal =
      action === 'pause'
        ? await goalService.pause(goalId)
        : action === 'resume'
          ? await goalService.resume(goalId)
          : await goalService.complete(goalId, evidence);
    if (!goal) {
      return toolNotFound();
    }
    return toolSuccess('goal', goal);
  } catch (error) {
    if (
      error instanceof InvalidGoalTransitionError ||
      error instanceof InvalidVerificationSurfaceError
    ) {
      return toolInvalidArgument();
    }
    if (error instanceof GoalVerificationRequiredError) {
      return toolInvalidArgument('verification_required');
    }
    if (error instanceof GoalCompletionBlockedError) {
      return toolInvalidArgument('blocked_by_incomplete_tasks');
    }
    throw error;
  }
}

export function createPauseGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string }) => Promise<ToolResult> {
  return async (args) => handleLifecycle(goalService, args.goal_id, 'pause');
}

export function createResumeGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string }) => Promise<ToolResult> {
  return async (args) => handleLifecycle(goalService, args.goal_id, 'resume');
}

export function createCompleteGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string; evidence?: VerificationEvidence }) => Promise<ToolResult> {
  return async (args) => handleLifecycle(goalService, args.goal_id, 'complete', args.evidence);
}
