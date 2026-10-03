import type { ArtifactService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createMoveScreenHandler(
  artifactService: ArtifactService,
): (args: { artifact_id: string; prototype_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const artifact = await artifactService.move(args.artifact_id, args.prototype_id);
    if (!artifact) {
      return toolNotFound();
    }
    return toolSuccess('artifact', artifact);
  };
}

export function createCopyScreenHandler(
  artifactService: ArtifactService,
): (args: { artifact_id: string; prototype_id: string }) => Promise<ToolResult> {
  return async (args) => {
    const artifact = await artifactService.copy(args.artifact_id, args.prototype_id);
    if (!artifact) {
      return toolNotFound();
    }
    return toolSuccess('artifact', artifact);
  };
}
