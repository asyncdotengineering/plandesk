import type { FileService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';
import {
  filenameFromPath,
  mimeFromFilename,
  readScopedFileBytes,
  xorPresent,
} from './file-path.js';

export type AttachFilePathDeps = {
  bindHost: string;
};

export function createAttachFileHandler(
  fileService: FileService,
  pathDeps: AttachFilePathDeps = { bindHost: '127.0.0.1' },
): (args: {
  project_id: string;
  filename?: string;
  content_base64?: string;
  file_path?: string;
  mime?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    if (!xorPresent(args.content_base64, args.file_path)) {
      return toolInvalidArgument('exactly one of content_base64 and file_path is required');
    }

    let bytes: Buffer;
    let filename: string;
    let mime: string;

    if (args.file_path !== undefined && args.file_path.length > 0) {
      const read = readScopedFileBytes(args.file_path, pathDeps.bindHost);
      if (!read.ok) {
        return read.error;
      }
      bytes = read.bytes;
      filename = args.filename ?? filenameFromPath(read.absolutePath);
      mime = args.mime ?? mimeFromFilename(filename);
    } else {
      if (typeof args.filename !== 'string' || args.filename.length === 0) {
        return toolInvalidArgument('filename is required with content_base64');
      }
      if (typeof args.content_base64 !== 'string') {
        return toolInvalidArgument('content_base64 is required');
      }
      bytes = Buffer.from(args.content_base64, 'base64');
      filename = args.filename;
      mime = args.mime ?? 'image/png';
    }

    const file = await fileService.create({
      projectId: args.project_id,
      filename,
      mime,
      bytes,
    });
    if (!file) {
      return toolNotFound();
    }
    return toolSuccess('file', { file_id: file.id, url: file.url });
  };
}
