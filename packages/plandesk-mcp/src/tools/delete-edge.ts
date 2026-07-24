import type { CanvasService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createDeleteEdgeHandler(
  canvasService: CanvasService,
): (args: { edge_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const deleted = await canvasService.deleteEdgeById(args.edge_id);
    if (!deleted) {
      return toolNotFound();
    }
    return toolSuccess('deleted', true);
  };
}
