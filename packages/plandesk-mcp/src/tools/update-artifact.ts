import type { ArtifactService } from '@plandesk/api';
import { InvalidArtifactError } from '@plandesk/api';
import type { ArtifactKind } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createUpdateArtifactHandler(
  artifactService: ArtifactService,
): (args: {
  artifact_id: string;
  title?: string;
  content?: string;
  kind?: ArtifactKind;
  prototype_id?: string | null;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const artifact = await artifactService.update(args.artifact_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.content !== undefined ? { content: args.content } : {}),
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        ...(args.prototype_id !== undefined ? { prototypeId: args.prototype_id } : {}),
      });
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
