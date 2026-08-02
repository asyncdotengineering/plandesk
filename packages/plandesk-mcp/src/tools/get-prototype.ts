import type { PrototypeService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetPrototypeHandler(
  prototypeService: PrototypeService,
): (args: { prototype_id: string }) => Promise<ToolResult> {
  return async ({ prototype_id }) => {
    const prototype = await prototypeService.get(prototype_id);
    if (!prototype) {
      return toolNotFound();
    }
    return toolSuccess('prototype', prototype);
  };
}
