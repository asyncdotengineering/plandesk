import type { ArtifactService } from '@plandesk/api';
import { InvalidArtifactError } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createMoveScreenHandler(
  artifactService: ArtifactService,
): (args: { artifact_id: string; prototype_id: string }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const artifact = await artifactService.move(args.artifact_id, args.prototype_id);
      if (!artifact) {
        return toolNotFound();
      }
      return toolSuccess('artifact', artifact);
    } catch (error) {
      if (error instanceof InvalidArtifactError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}

export function createCopyScreenHandler(
  artifactService: ArtifactService,
): (args: { artifact_id: string; prototype_id: string }) => Promise<ToolResult> {
  return async (args) => {
    try {
      const artifact = await artifactService.copy(args.artifact_id, args.prototype_id);
      if (!artifact) {
        return toolNotFound();
      }
      return toolSuccess('artifact', artifact);
    } catch (error) {
      if (error instanceof InvalidArtifactError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
