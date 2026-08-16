import type { ArtifactService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createGetArtifactHandler(
  artifactService: ArtifactService,
): (args: { artifact_id: string }) => Promise<ToolResult> {
  return async ({ artifact_id }) => {
    const artifact = await artifactService.get(artifact_id);
    if (!artifact) {
      return toolNotFound();
    }
    return toolSuccess('artifact', artifact);
  };
}
