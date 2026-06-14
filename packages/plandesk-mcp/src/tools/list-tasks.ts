import type { TaskService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';
import type { TaskStatus } from '@plandesk/db';

export function createListTasksHandler(
  taskService: TaskService,
): (args: { project_id: string; status?: TaskStatus }) => ToolResult {
  return (args) => {
    let tasks;
    try {
      tasks = taskService.listByProject(
        args.project_id,
        args.status !== undefined ? { status: args.status } : {},
      );
    } catch {
      return toolInvalidArgument('invalid status value');
    }
    if (tasks === undefined) {
      return toolNotFound();
    }
    return toolSuccess('tasks', tasks);
  };
}
