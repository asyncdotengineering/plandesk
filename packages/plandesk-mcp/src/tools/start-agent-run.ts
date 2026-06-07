import type { AgentRunService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createStartAgentRunHandler(
  agentRunService: AgentRunService,
): (args: { project_id: string; label?: string }) => ToolResult {
  return (args) => {
    const run = agentRunService.start(args.project_id, args.label);
    if (!run) {
      return toolNotFound();
    }
    return toolSuccess('agent_run', run);
  };
}
