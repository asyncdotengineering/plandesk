import type { TaskService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

export function createGetTaskGraphHandler(
  taskService: TaskService,
): (args: { project_id: string; goal_id?: string }) => Promise<ToolResult> {
  return async (args) => {
    const graph = await taskService.getTaskGraph(args.project_id, args.goal_id);
    if (!graph) {
      return toolNotFound();
    }
    return toolSuccessPayload(graph);
  };
}
