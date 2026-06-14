import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetTaskHandler(
  taskService: TaskService,
): (args: { task_id: string }) => ToolResult {
  return (args) => {
    const task = taskService.get(args.task_id);
    if (!task) {
      return toolNotFound();
    }
    return toolSuccess('task', task);
  };
}
