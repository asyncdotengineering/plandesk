import {
  GoalCompletionBlockedError,
  GoalVerificationRequiredError,
  InvalidGoalTransitionError,
  InvalidVerificationSurfaceError,
  type GoalService,
  type VerificationEvidence,
} from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

function handleLifecycle(
  goalService: GoalService,
  goalId: string,
  action: 'pause' | 'resume',
): ToolResult;
function handleLifecycle(
  goalService: GoalService,
  goalId: string,
  action: 'complete',
  evidence?: VerificationEvidence,
): ToolResult;
function handleLifecycle(
  goalService: GoalService,
  goalId: string,
  action: 'pause' | 'resume' | 'complete',
  evidence?: VerificationEvidence,
): ToolResult {
  try {
    const goal =
      action === 'pause'
        ? goalService.pause(goalId)
        : action === 'resume'
          ? goalService.resume(goalId)
          : goalService.complete(goalId, evidence);
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
): (args: { goal_id: string }) => ToolResult {
  return (args) => handleLifecycle(goalService, args.goal_id, 'pause');
}

export function createResumeGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string }) => ToolResult {
  return (args) => handleLifecycle(goalService, args.goal_id, 'resume');
}

export function createCompleteGoalHandler(
  goalService: GoalService,
): (args: { goal_id: string; evidence?: VerificationEvidence }) => ToolResult {
  return (args) => handleLifecycle(goalService, args.goal_id, 'complete', args.evidence);
}
