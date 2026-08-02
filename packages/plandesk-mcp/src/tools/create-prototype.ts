import type { PrototypeService } from '@plandesk/api';
import { InvalidPrototypeError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreatePrototypeHandler(
  prototypeService: PrototypeService,
): (args: {
  project_id: string;
  name: string;
  viewport_width: number;
  viewport_height: number;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const prototype = await prototypeService.create(args.project_id, {
        name: args.name,
        viewportWidth: args.viewport_width,
        viewportHeight: args.viewport_height,
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
