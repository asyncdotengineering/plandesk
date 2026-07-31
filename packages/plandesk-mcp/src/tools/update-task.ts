import { InvalidCommitRefsError, InvalidGoalReferenceError, InvalidTagError, type TaskService } from '@plandesk/api';
import { InvalidTaskStatusError, type TaskStatus } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateTaskHandler(
  taskService: TaskService,
): (args: {
  task_id: string;
  status?: string;
  label?: string;
  description?: string;
  x?: number;
  y?: number;
  goal_id?: string;
  tags?: string[];
  commit_refs?: string[] | null;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const task = await taskService.update(args.task_id, {
        ...(args.status !== undefined ? { status: args.status as TaskStatus } : {}),
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.x !== undefined ? { x: args.x } : {}),
        ...(args.y !== undefined ? { y: args.y } : {}),
        ...(args.goal_id !== undefined ? { goalId: args.goal_id } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
        ...(args.commit_refs !== undefined ? { commitRefs: args.commit_refs } : {}),
      });
      if (!task) {
        return toolNotFound();
      }
      return toolSuccess('task', task);
    } catch (error) {
      if (
        error instanceof InvalidTaskStatusError ||
        error instanceof InvalidTagError ||
        error instanceof InvalidGoalReferenceError ||
        error instanceof InvalidCommitRefsError
      ) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
