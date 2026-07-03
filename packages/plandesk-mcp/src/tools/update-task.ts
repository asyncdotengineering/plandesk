import { InvalidTagError, type TaskService } from '@plandesk/api';
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
  tags?: string[];
}) => ToolResult {
  return (args) => {
    try {
      const task = taskService.update(args.task_id, {
        ...(args.status !== undefined ? { status: args.status as TaskStatus } : {}),
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.x !== undefined ? { x: args.x } : {}),
        ...(args.y !== undefined ? { y: args.y } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
      });
      if (!task) {
        return toolNotFound();
      }
      return toolSuccess('task', task);
    } catch (error) {
      if (error instanceof InvalidTaskStatusError || error instanceof InvalidTagError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}
