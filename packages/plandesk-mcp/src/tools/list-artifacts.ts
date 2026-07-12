import type { ArtifactService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createListArtifactsHandler(
  artifactService: ArtifactService,
): (args: { project_id: string }) => ToolResult {
  return ({ project_id }) => {
    const artifacts = artifactService.listByProject(project_id);
    if (!artifacts) {
      return toolNotFound();
    }
    return toolSuccess('artifacts', artifacts);
  };
}