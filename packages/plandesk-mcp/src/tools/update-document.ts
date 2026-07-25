import type { CanvasService, DocumentService, TaskService } from '@plandesk/api';
import { InvalidCanvasError, InvalidDocumentError } from '@plandesk/api';
import { ensureHtmlBody } from './markdown.js';
import { defaultLinkLabel, normalizeLinkTo, type LinkEntityKind } from './link-to.js';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export type UpdateDocumentArgs = {
  document_id: string;
  title?: string;
  body?: string;
  status_line?: string;
  linked_task_id?: string | null;
  /** Task or document id(s) to ensure as outgoing links. Single string or list. */
  link_to?: string | string[];
  folder_id?: string | null;
};

async function resolveEntityKind(
  taskService: TaskService,
  documentService: DocumentService,
  projectId: string,
  id: string,
): Promise<LinkEntityKind | undefined> {
  const task = await taskService.get(id);
  if (task && task.project_id === projectId) {
    return 'task';
  }
  const document = await documentService.get(id);
  if (document && document.project_id === projectId) {
    return 'document';
  }
  return undefined;
}

export function createUpdateDocumentHandler(
  documentService: DocumentService,
  canvasService: CanvasService,
  taskService: TaskService,
): (args: UpdateDocumentArgs) => Promise<ToolResult> {
  return async (args) => {
    try {
      const existing = await documentService.get(args.document_id);
      if (!existing) {
        return toolNotFound();
      }

      const document = await documentService.update(args.document_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: ensureHtmlBody(args.body) } : {}),
        ...(args.status_line !== undefined ? { statusLine: args.status_line } : {}),
        ...(args.linked_task_id !== undefined ? { linkedTaskId: args.linked_task_id } : {}),
        ...(args.folder_id !== undefined ? { folderId: args.folder_id } : {}),
      });
      if (!document) {
        return toolNotFound();
      }

      const linkTargets = normalizeLinkTo(args.link_to);
      if (linkTargets.length === 0) {
        return toolSuccess('document', document);
      }

      const existingLinkIds = new Set(
        (document.links ?? []).map((link: { id: string }) => link.id),
      );
      // After linked_task_id update the primary may already be present.
      if (document.linked_task_id) {
        existingLinkIds.add(document.linked_task_id);
      }

      for (const id of linkTargets) {
        if (existingLinkIds.has(id)) {
          continue;
        }
        const type = await resolveEntityKind(
          taskService,
          documentService,
          document.project_id,
          id,
        );
        if (type === undefined) {
          return toolInvalidArgument(`link_to target not found in project: ${id}`);
        }
        await canvasService.createEdge(document.project_id, {
          fromType: 'document',
          fromId: document.id,
          toType: type,
          toId: id,
          label: defaultLinkLabel(type),
        });
      }

      const hydrated = await documentService.get(document.id);
      return toolSuccess('document', hydrated ?? document);
    } catch (error) {
      if (error instanceof InvalidDocumentError || error instanceof InvalidCanvasError) {
        return toolInvalidArgument(error.message);
      }
      throw error;
    }
  };
}
