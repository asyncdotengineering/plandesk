import type { DocumentService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

type JsonRecord = Record<string, unknown>;

// Strips `body` from a document tree node, recursing into `children`.
function compactDocument(doc: JsonRecord): JsonRecord {
  const { body, children, ...rest } = doc as JsonRecord & { children?: JsonRecord[] };
  void body;
  return Array.isArray(children) ? { ...rest, children: children.map(compactDocument) } : rest;
}

// Strips `body` from a folder-tree node's nested documents and sub-folders.
function compactFolderTree(node: JsonRecord): JsonRecord {
  const { folders, documents, ...rest } = node as JsonRecord & {
    folders?: JsonRecord[];
    documents?: JsonRecord[];
  };
  return {
    ...rest,
    ...(Array.isArray(folders) ? { folders: folders.map(compactFolderTree) } : {}),
    ...(Array.isArray(documents) ? { documents: documents.map(compactDocument) } : {}),
  };
}

export function createListDocumentsHandler(
  documentService: DocumentService,
): (args: { project_id: string; folder_id?: string; compact?: boolean }) => Promise<ToolResult> {
  return async ({ project_id, folder_id, compact }) => {
    if (folder_id !== undefined) {
      const documents = await documentService.listByFolder(project_id, folder_id);
      if (!documents) {
        return toolNotFound();
      }
      return toolSuccessPayload({
        documents: compact ? documents.map(compactDocument) : documents,
      });
    }

    const tree = await documentService.listFolderTree(project_id);
    if (!tree) {
      return toolNotFound();
    }
    if (!compact) {
      return toolSuccessPayload({ documents: tree.documents, folders: tree.folders });
    }
    return toolSuccessPayload({
      documents: tree.documents.map(compactDocument),
      folders: tree.folders.map(compactFolderTree),
    });
  };
}
