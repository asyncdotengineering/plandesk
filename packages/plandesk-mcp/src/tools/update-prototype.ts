import type { PrototypeService } from '@plandesk/api';
import { InvalidPrototypeError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdatePrototypeHandler(
  prototypeService: PrototypeService,
): (args: {
  prototype_id: string;
  name?: string;
  viewport_width?: number;
  viewport_height?: number;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const prototype = await prototypeService.update(args.prototype_id, {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.viewport_width !== undefined ? { viewportWidth: args.viewport_width } : {}),
        ...(args.viewport_height !== undefined ? { viewportHeight: args.viewport_height } : {}),
      });
      if (!prototype) {
        return toolNotFound();
      }
      return toolSuccess('prototype', prototype);
    } catch (error) {
      if (error instanceof InvalidPrototypeError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
