import type { ArtifactService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetArtifactHandler(
  artifactService: ArtifactService,
): (args: { artifact_id: string }) => ToolResult {
  return ({ artifact_id }) => {
    const artifact = artifactService.get(artifact_id);
    if (!artifact) {
      return toolNotFound();
    }
    return toolSuccess('artifact', artifact);
  };
}