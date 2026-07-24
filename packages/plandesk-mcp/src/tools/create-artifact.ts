import type { ArtifactService } from '@plandesk/api';
import { InvalidArtifactError } from '@plandesk/api';
import type { ArtifactKind } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createCreateArtifactHandler(
  artifactService: ArtifactService,
): (args: {
  project_id: string;
  title: string;
  content: string;
  kind?: ArtifactKind;
}) => Promise<ToolResult> {
  return async (args) => {
    try {
      const artifact = await artifactService.create(args.project_id, {
        title: args.title,
        content: args.content,
        kind: args.kind,
      });
      if (!artifact) {
        return toolNotFound();
      }
      return toolSuccess('artifact', {
        artifact_id: artifact.id,
        url: `/api/v1/artifacts/${artifact.id}`,
      });
    } catch (error) {
      if (error instanceof InvalidArtifactError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}