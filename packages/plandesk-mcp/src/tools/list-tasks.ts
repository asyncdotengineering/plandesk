import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';
import type { TaskKind, TaskLane, TaskPriority, TaskSeverity, TaskStatus } from '@plandesk/db';

export function createListTasksHandler(
  taskService: TaskService,
): (args: {
  project_id: string;
  status?: TaskStatus;
  kind?: TaskKind;
  priority?: TaskPriority;
  lane?: TaskLane;
  severity?: TaskSeverity;
  tags?: string[];
  verbose?: boolean;
}) => Promise<ToolResult> {
  return async (args) => {
    const tasks = await taskService.listByProject(args.project_id, {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.priority !== undefined ? { priority: args.priority } : {}),
      ...(args.lane !== undefined ? { lane: args.lane } : {}),
      ...(args.severity !== undefined ? { severity: args.severity } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
    });
    if (tasks === undefined) {
      return toolNotFound();
    }
    if (args.verbose) {
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
