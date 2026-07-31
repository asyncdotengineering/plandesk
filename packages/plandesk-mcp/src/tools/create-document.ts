import type { CanvasService, DocumentService, TaskService } from '@plandesk/api';
import { InvalidCanvasError, InvalidDocumentError } from '@plandesk/api';
import { defaultLinkLabel, normalizeLinkTo, type LinkEntityKind } from './link-to.js';
import { toolInvalidArgument, toolNotFound, toolSuccess, type ToolResult } from './result.js';

export type CreateDocumentArgs = {
  project_id: string;
  title: string;
  body?: string;
  /** Task or document id(s) to link. Single string or list. */
  link_to?: string | string[];
  parent_id?: string;
  folder_id?: string;
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

export function createCreateDocumentHandler(
  documentService: DocumentService,
  canvasService: CanvasService,
  taskService: TaskService,
): (args: CreateDocumentArgs) => Promise<ToolResult> {
  return async (args) => {
    try {
      const linkTargets = normalizeLinkTo(args.link_to);
      const resolved: Array<{ id: string; type: LinkEntityKind }> = [];
      for (const id of linkTargets) {
        const type = await resolveEntityKind(taskService, documentService, args.project_id, id);
        if (type === undefined) {
          return toolInvalidArgument(`link_to target not found in project: ${id}`);
        }
        resolved.push({ id, type });
      }

      const document = await documentService.create(args.project_id, {
        title: args.title,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.parent_id !== undefined ? { parentId: args.parent_id } : {}),
        ...(args.folder_id !== undefined ? { folderId: args.folder_id } : {}),
      });
      if (!document) {
        return toolNotFound();
      }

      for (const target of resolved) {
        await canvasService.createEdge(args.project_id, {
          fromType: 'document',
          fromId: document.id,
          toType: target.type,
          toId: target.id,
          label: defaultLinkLabel(target.type),
        });
      }

      if (resolved.length === 0) {
        return toolSuccess('document', document);
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
