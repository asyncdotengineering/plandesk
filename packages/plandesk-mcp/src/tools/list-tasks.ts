import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';
import type { TaskStatus } from '@plandesk/db';

export function createListTasksHandler(
  taskService: TaskService,
): (args: { project_id: string; status?: TaskStatus }) => ToolResult {
  return (args) => {
    const tasks = taskService.listByProject(
      args.project_id,
      args.status !== undefined ? { status: args.status } : {},
    );
    if (tasks === undefined) {
      return toolNotFound();
    }
    return toolSuccess('tasks', tasks);
  };
}
