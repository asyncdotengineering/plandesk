import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';
import type { TaskStatus } from '@plandesk/db';

export function createListTasksHandler(
  taskService: TaskService,
): (args: {
  project_id: string;
  status?: TaskStatus;
  tags?: string[];
  compact?: boolean;
}) => Promise<ToolResult> {
  return async (args) => {
    const tasks = await taskService.listByProject(args.project_id, {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
    });
    if (tasks === undefined) {
      return toolNotFound();
    }
    if (!args.compact) {
      return toolSuccess('tasks', tasks);
    }
    return toolSuccess(
      'tasks',
      tasks.map((task) => {
        const { description, ...rest } = task;
        void description;
        return rest;
      }),
    );
  };
}
