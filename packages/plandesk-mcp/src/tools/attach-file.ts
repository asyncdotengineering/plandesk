import type { FileService } from '@plandesk/api';
import { toolNotFound, toolSuccess, type ToolResult } from './result.js';

export function createAttachFileHandler(
  fileService: FileService,
): (args: {
  project_id: string;
  filename: string;
  content_base64: string;
  mime?: string;
}) => Promise<ToolResult> {
  return async (args) => {
    const file = await fileService.create({
      projectId: args.project_id,
      filename: args.filename,
      mime: args.mime ?? 'image/png',
      bytes: Buffer.from(args.content_base64, 'base64'),
    });
    if (!file) {
      return toolNotFound();
    }
    return toolSuccess('file', { file_id: file.id, url: file.url });
  };
}
