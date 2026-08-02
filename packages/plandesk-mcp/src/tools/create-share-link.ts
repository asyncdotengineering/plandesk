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
  prototype_id?: string;
  expires?: '24h' | '7d' | 'never';
}) => Promise<ToolResult> {
  return async (args) => {
    const targets = [
      args.task_id !== undefined,
      args.document_id !== undefined,
      args.prototype_id !== undefined,
    ].filter(Boolean).length;
    if (targets !== 1) {
      return toolInvalidArgument(
        'Exactly one of task_id, document_id, or prototype_id is required',
      );
    }

    const expires = args.expires ?? '24h';
    const expiresAt = expires === 'never' ? null : new Date(Date.now() + EXPIRES_MS[expires]);

    const resource =
      args.task_id !== undefined
        ? { kind: 'task' as const, id: args.task_id }
        : args.document_id !== undefined
          ? { kind: 'document' as const, id: args.document_id }
          : { kind: 'prototype' as const, ids: [args.prototype_id as string] };

    const result = await shareService.createResourceShare({ resource, expiresAt }, getOrigin());

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
