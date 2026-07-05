import {
  GoalCompletionBlockedError,
  InvalidGoalTransitionError,
  type GoalService,
} from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

function handleLifecycle(
  goalService: GoalService,
  goalId: string,
  action: 'pause' | 'resume' | 'complete',
): ToolResult {
  try {
    const goal =
      action === 'pause'
        ? goalService.pause(goalId)
        : action === 'resume'
          ? goalService.resume(goalId)
          : goalService.complete(goalId);
    if (!goal) {
      return toolNotFound();
    }
    return toolSuccess('goal', goal);
  } catch (error) {
    if (error instanceof InvalidGoalTransitionError) {
      return toolInvalidArgument();
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
): (args: { goal_id: string }) => ToolResult {
  return (args) => handleLifecycle(goalService, args.goal_id, 'complete');
}