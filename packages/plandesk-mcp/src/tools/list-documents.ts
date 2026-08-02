import type { DocumentService } from '@plandesk/api';
import { toolNotFound, toolSuccessPayload, type ToolResult } from './result.js';

type JsonRecord = Record<string, unknown>;

// Strips `body` from a document tree node, recursing into `children`.
function summaryDocument(doc: JsonRecord): JsonRecord {
  const { body, children, ...rest } = doc as JsonRecord & { children?: JsonRecord[] };
  void body;
  return Array.isArray(children) ? { ...rest, children: children.map(summaryDocument) } : rest;
}

// Strips `body` from a folder-tree node's nested documents and sub-folders.
function summaryFolderTree(node: JsonRecord): JsonRecord {
  const { folders, documents, ...rest } = node as JsonRecord & {
    folders?: JsonRecord[];
    documents?: JsonRecord[];
  };
  return {
    ...rest,
    ...(Array.isArray(folders) ? { folders: folders.map(summaryFolderTree) } : {}),
    ...(Array.isArray(documents) ? { documents: documents.map(summaryDocument) } : {}),
  };
}

export function createListDocumentsHandler(
  documentService: DocumentService,
): (args: { project_id: string; folder_id?: string; verbose?: boolean }) => Promise<ToolResult> {
  return async ({ project_id, folder_id, verbose }) => {
    if (folder_id !== undefined) {
      const documents = await documentService.listByFolder(project_id, folder_id);
      if (!documents) {
        return toolNotFound();
      }
      return toolSuccessPayload({
        documents: verbose ? documents : documents.map(summaryDocument),
      });
    }

    const tree = await documentService.listFolderTree(project_id);
    if (!tree) {
      return toolNotFound();
    }
    if (verbose) {
      return toolSuccessPayload({ documents: tree.documents, folders: tree.folders });
    }
    return toolSuccessPayload({
      documents: tree.documents.map(summaryDocument),
      folders: tree.folders.map(summaryFolderTree),
    });
  };
}
