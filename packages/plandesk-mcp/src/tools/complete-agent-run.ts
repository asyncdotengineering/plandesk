import type { AgentRunService } from '@plandesk/api';
import { InvalidAgentRunError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCompleteAgentRunHandler(
  agentRunService: AgentRunService,
): (args: { run_id: string; status: 'completed' | 'failed' }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const run = await agentRunService.complete(args.run_id, args.status);
      if (!run) {
        return toolNotFound();
      }
      return toolSuccess('agent_run', run);
    } catch (error) {
      if (error instanceof InvalidAgentRunError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
