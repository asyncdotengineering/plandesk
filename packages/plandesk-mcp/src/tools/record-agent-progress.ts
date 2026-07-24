import type { AgentRunService } from '@plandesk/api';
import { InvalidAgentRunError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createRecordAgentProgressHandler(
  agentRunService: AgentRunService,
): (args: { run_id: string; message: string }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const event = await agentRunService.recordProgress(args.run_id, args.message);
      if (!event) {
        return toolNotFound();
      }
      return toolSuccess('event', event);
    } catch (error) {
      if (error instanceof InvalidAgentRunError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
