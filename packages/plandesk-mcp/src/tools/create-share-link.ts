import type { ShareService } from '@plandesk/api';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

const EXPIRES_MS: Record<'24h' | '7d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function createCreateShareLinkHandler(
  shareService: ShareService,
  getOrigin: () => string,
): (args: {
  task_id?: string;
  document_id?: string;
  expires?: '24h' | '7d' | 'never';
}) => ToolResult {
  return (args) => {
    const hasTask = args.task_id !== undefined;
    const hasDocument = args.document_id !== undefined;
    if (hasTask === hasDocument) {
      return toolInvalidArgument('Exactly one of task_id or document_id is required');
    }

    const expires = args.expires ?? '24h';
    const expiresAt = expires === 'never' ? null : new Date(Date.now() + EXPIRES_MS[expires]);

    const result = shareService.createResourceShare(
      {
        resource: hasTask
          ? { kind: 'task', id: args.task_id as string }
          : { kind: 'document', id: args.document_id as string },
        expiresAt,
      },
      getOrigin(),
    );

    if (!result) {
      return toolNotFound();
    }

    return toolSuccess('share', {
      url: result.url,
      markdown_url: result.markdownUrl,
      expires_at: result.expiresAt,
    });
  };
}
