import type { ArtifactService } from '@plandesk/api';
import { InvalidArtifactError } from '@plandesk/api';
import type { ArtifactKind } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';
import { readScopedFileBytes, xorPresent } from './file-path.js';

export type ArtifactFilePathDeps = {
  bindHost: string;
};

export function createCreateArtifactHandler(
  artifactService: ArtifactService,
  pathDeps: ArtifactFilePathDeps = { bindHost: '127.0.0.1' },
): (args: {
  project_id: string;
  title: string;
  content?: string;
  file_path?: string;
  kind?: ArtifactKind;
  prototype_id?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    if (!xorPresent(args.content, args.file_path)) {
      return toolInvalidArgument('exactly one of content and file_path is required');
    }

    let content: string;
    if (args.file_path !== undefined && args.file_path.length > 0) {
      const read = readScopedFileBytes(args.file_path, pathDeps.bindHost);
      if (!read.ok) {
        return read.error;
      }
      content = read.bytes.toString('utf8');
    } else {
      content = args.content ?? '';
    }

    try {
      const artifact = await artifactService.create(args.project_id, {
        title: args.title,
        content,
        kind: args.kind,
        ...(args.prototype_id !== undefined ? { prototypeId: args.prototype_id } : {}),
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
