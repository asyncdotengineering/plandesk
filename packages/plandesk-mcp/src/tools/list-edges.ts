import type { CanvasService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListEdgesHandler(
  canvasService: CanvasService,
): (args: { project_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const edges = await canvasService.listEdges(args.project_id);
    if (!edges) {
      return toolNotFound();
    }
    return toolSuccess('edges', edges);
  };
}
