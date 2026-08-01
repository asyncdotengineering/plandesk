import type { RevisionService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetRevisionHandler(
  revisionService: RevisionService,
): (args: { revision_id: string }) => Promise<ToolResult> {
  return async ({ revision_id }) => {
    const revision = await revisionService.get(revision_id);
    if (!revision) {
      return toolNotFound();
    }
    return toolSuccess('revision', revision);
  };
}
