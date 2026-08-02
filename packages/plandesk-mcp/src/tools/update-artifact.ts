import type { ArtifactService } from '@plandesk/api';
import { InvalidArtifactError } from '@plandesk/api';
import type { ArtifactKind } from '@plandesk/db';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';
import { readScopedFileBytes } from './file-path.js';

export type ArtifactFilePathDeps = {
  bindHost: string;
};

export function createUpdateArtifactHandler(
  artifactService: ArtifactService,
  pathDeps: ArtifactFilePathDeps = { bindHost: '127.0.0.1' },
): (args: {
  artifact_id: string;
  title?: string;
  content?: string;
  file_path?: string;
  kind?: ArtifactKind;
  prototype_id?: string | null;
}) => Promise<ToolResult> {
  return async (args) => {
    const hasContent = typeof args.content === 'string';
    const hasPath = typeof args.file_path === 'string' && args.file_path.length > 0;
    if (hasContent && hasPath) {
      return toolInvalidArgument('exactly one of content and file_path is required');
    }

    let content: string | undefined = args.content;
    if (hasPath) {
      const path = args.file_path;
      if (typeof path !== 'string' || path.length === 0) {
        return toolInvalidArgument('file_path is required');
      }
      const read = readScopedFileBytes(path, pathDeps.bindHost);
      if (!read.ok) {
        return read.error;
      }
      content = read.bytes.toString('utf8');
    }

    try {
      const artifact = await artifactService.update(args.artifact_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(content !== undefined ? { content } : {}),
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
