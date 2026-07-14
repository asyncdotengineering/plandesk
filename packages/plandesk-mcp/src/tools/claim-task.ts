import type { TaskService } from '@plandesk/api';
import { toolSuccessPayload, type ToolResult } from './result.js';

export function createClaimTaskHandler(
  taskService: TaskService,
): (args: { task_id: string; agent_ref: string }) => Promise<ToolResult> {
  return async (args) => {
    const result = await taskService.claim(args.task_id, args.agent_ref);
    return toolSuccessPayload(result);
  };
}
