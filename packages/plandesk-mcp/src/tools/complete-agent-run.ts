import type { AgentRunService } from '@plandesk/api';
import { InvalidAgentRunError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCompleteAgentRunHandler(
  agentRunService: AgentRunService,
): (args: { run_id: string; status: 'completed' | 'failed' }) => ToolResult {
  return (args) => {
    try {
      const run = agentRunService.complete(args.run_id, args.status);
      if (!run) {
        return toolNotFound();
      }
      return toolSuccess('agent_run', run);
    } catch (error) {
      if (error instanceof InvalidAgentRunError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}
