import type { CanvasService } from '@plandesk/api';
import { InvalidCanvasError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export type CreateEdgeArgs = {
  project_id: string;
  from_type?: 'task' | 'document';
  from_id?: string;
  to_type?: 'task' | 'document';
  to_id?: string;
  /** Legacy task-shaped fields — still accepted and mapped to type `task`. */
  from_task_id?: string;
  to_task_id?: string;
  label?: string;
  style?: string;
};

export function createCreateEdgeHandler(
  canvasService: CanvasService,
): (args: CreateEdgeArgs) => Promise<ToolResult> {
  return async (args) => {
    try {
      const edge = await canvasService.createEdge(args.project_id, {
        ...(args.from_type !== undefined ? { fromType: args.from_type } : {}),
        ...(args.from_id !== undefined ? { fromId: args.from_id } : {}),
        ...(args.to_type !== undefined ? { toType: args.to_type } : {}),
        ...(args.to_id !== undefined ? { toId: args.to_id } : {}),
        ...(args.from_task_id !== undefined ? { fromTaskId: args.from_task_id } : {}),
        ...(args.to_task_id !== undefined ? { toTaskId: args.to_task_id } : {}),
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.style !== undefined ? { style: args.style } : {}),
      });
      if (!edge) {
        return toolNotFound();
      }
      return toolSuccess('edge', edge);
    } catch (error) {
      if (error instanceof InvalidCanvasError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
