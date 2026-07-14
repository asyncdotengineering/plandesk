import type { CanvasService } from '@plandesk/api';
import { InvalidCanvasError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateEdgeHandler(
  canvasService: CanvasService,
): (args: {
  project_id: string;
  from_task_id: string;
  to_task_id: string;
  label?: string;
  style?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const edge = await canvasService.createEdge(args.project_id, {
        fromTaskId: args.from_task_id,
        toTaskId: args.to_task_id,
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.style !== undefined ? { style: args.style } : {}),
      });
      if (!edge) {
        return toolNotFound();
      }
      return toolSuccess('edge', edge);
    } catch (error) {
      if (error instanceof InvalidCanvasError) {
        return toolInvalidArgument();
      }
      throw error;
    }
  };
}
