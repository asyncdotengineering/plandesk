import type { TaskService } from '@plandesk/api';
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
}) => ToolResult {
  return (args) => {
    try {
      const task = taskService.create(args.project_id, {
        label: args.label,
        ...(args.status !== undefined ? { status: args.status as TaskStatus } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.x !== undefined ? { x: args.x } : {}),
        ...(args.y !== undefined ? { y: args.y } : {}),
      });
      if (!task) {
        return toolNotFound();
      }
      return toolSuccess('task', task);
    } catch (error) {
      if (error instanceof InvalidTaskStatusError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}
