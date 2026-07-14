import type { AgentRunService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createStartAgentRunHandler(
  agentRunService: AgentRunService,
): (args: { project_id: string; label?: string }) => Promise<ToolResult> {
  return async (args) => {
    const run = await agentRunService.start(args.project_id, args.label);
    if (!run) {
      return toolNotFound();
    }
    return toolSuccess('agent_run', run);
  };
}
