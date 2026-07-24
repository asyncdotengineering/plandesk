import { InvalidGoalReferenceError, InvalidTagError, type TaskService } from '@plandesk/api';
import { InvalidTaskStatusError, type TaskStatus } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateTaskHandler(
  taskService: TaskService,
): (args: {
  project_id: string;
  label: string;
  status?: string;
  description?: string;
  x?: number;
  y?: number;
  goal_id?: string;
  tags?: string[];
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const task = await taskService.create(args.project_id, {
        label: args.label,
        ...(args.status !== undefined ? { status: args.status as TaskStatus } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.x !== undefined ? { x: args.x } : {}),
        ...(args.y !== undefined ? { y: args.y } : {}),
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
        error instanceof InvalidTagError ||
        error instanceof InvalidGoalReferenceError
      ) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
