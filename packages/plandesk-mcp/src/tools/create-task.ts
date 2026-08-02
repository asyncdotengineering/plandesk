import { InvalidGoalReferenceError, InvalidTagError, type TaskService } from '@plandesk/api';
import {
  InvalidTaskKindError,
  InvalidTaskLaneError,
  InvalidTaskPriorityError,
  InvalidTaskStatusError,
  InvalidTaskSeverityError,
  type TaskKind,
  type TaskLane,
  type TaskPriority,
  type TaskSeverity,
  type TaskStatus,
} from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateTaskHandler(
  taskService: TaskService,
): (args: {
  project_id: string;
  label: string;
  status?: string;
  kind?: string;
  priority?: string | null;
  lane?: string | null;
  severity?: string | null;
  description?: string;
  x?: number;
  y?: number;
  assignee?: string | null;
  goal_id?: string;
  tags?: string[];
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const task = await taskService.create(args.project_id, {
        label: args.label,
        ...(args.status !== undefined ? { status: args.status as TaskStatus } : {}),
        ...(args.kind !== undefined ? { kind: args.kind as TaskKind } : {}),
        ...(args.priority !== undefined ? { priority: args.priority as TaskPriority | null } : {}),
        ...(args.lane !== undefined ? { lane: args.lane as TaskLane | null } : {}),
        ...(args.severity !== undefined ? { severity: args.severity as TaskSeverity | null } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.x !== undefined ? { x: args.x } : {}),
        ...(args.y !== undefined ? { y: args.y } : {}),
        ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
        ...(args.goal_id !== undefined ? { goalId: args.goal_id } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
      });
      if (!task) {
        return toolNotFound();
      }
      return toolSuccess('task', task);
    } catch (error) {
      if (
        error instanceof InvalidTaskStatusError ||
        error instanceof InvalidTaskKindError ||
        error instanceof InvalidTaskPriorityError ||
        error instanceof InvalidTaskLaneError ||
        error instanceof InvalidTaskSeverityError ||
        error instanceof InvalidTagError ||
        error instanceof InvalidGoalReferenceError
      ) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
