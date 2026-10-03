import type { ReferenceCheckService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

export function createCheckReferencesHandler(
  referenceCheckService: ReferenceCheckService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const result = await referenceCheckService.check(args.project_id);
    if (!result) {
      return toolNotFound();
    }
    return toolSuccessPayload(result);
  };
}
