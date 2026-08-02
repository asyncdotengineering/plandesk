import type { PrototypeService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListPrototypesHandler(
  prototypeService: PrototypeService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async ({ project_id }) => {
    const prototypes = await prototypeService.list(project_id);
    if (!prototypes) {
      return toolNotFound();
    }
    return toolSuccess('prototypes', prototypes);
  };
}
