import {
  createDocument as dbCreateDocument,
  deleteCommentsByTarget,
  deleteDocument as dbDeleteDocument,
  detachDocumentChildren,
  getDocument as dbGetDocument,
  getDocumentByTask as dbGetDocumentByTask,
  getFolderByProjectAndId,
  getProject,
  getTask,
  listDocuments as dbListDocuments,
  listFolders as dbListFolders,
  updateDocument as dbUpdateDocument,
  type Db,
} from '@plandesk/db';
import {
  buildDocumentTree,
  buildFolderTree,
  serializeDocument,
  type PaginationParams,
  type SerializedDocument,
  type SerializedDocumentFolderTree,
  type SerializedDocumentTree,
} from '../serialize.js';
import type { EventBus } from '../events.js';

export type DocumentServiceDeps = {
  db: Db;
  eventBus: EventBus;
};

export type CreateDocumentInput = {
  title: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
  folderId?: string | null;
  linkedTaskId?: string | null;
};

export type UpdateDocumentInput = {
  title?: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
  folderId?: string | null;
  linkedTaskId?: string | null;
};

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentError';
  }
}

function assertTaskInProject(db: Db, projectId: string, taskId: string): void {
  const task = getTask(db, taskId);
  if (!task || task.projectId !== projectId) {
    throw new InvalidDocumentError('Task does not belong to project');
  }
}

function assertParentInProject(db: Db, projectId: string, parentId: string): void {
  const parent = dbGetDocument(db, parentId);
  if (!parent || parent.projectId !== projectId) {
    throw new InvalidDocumentError('Parent document does not belong to project');
  }
}

function assertFolderInProject(db: Db, projectId: string, folderId: string): void {
  if (!getFolderByProjectAndId(db, projectId, folderId)) {
    throw new InvalidDocumentError('Folder does not belong to project');
  }
}

export function createDocumentService(deps: DocumentServiceDeps) {
  const { db, eventBus } = deps;

  return {
    listTree(
      projectId: string,
      pagination: PaginationParams = {},
    ): SerializedDocumentTree[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return buildDocumentTree(dbListDocuments(db, projectId, pagination));
    },

    listFolderTree(projectId: string): SerializedDocumentFolderTree | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return buildFolderTree(dbListFolders(db, projectId), dbListDocuments(db, projectId));
    },

    listByFolder(projectId: string, folderId: string): SerializedDocumentTree[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      if (!getFolderByProjectAndId(db, projectId, folderId)) {
        return undefined;
      }
      return buildDocumentTree(dbListDocuments(db, projectId, { folderId }));
    },

    create(projectId: string, input: CreateDocumentInput): SerializedDocument | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      if (input.linkedTaskId !== undefined && input.linkedTaskId !== null) {
        assertTaskInProject(db, projectId, input.linkedTaskId);
      }

      if (input.parentId !== undefined && input.parentId !== null) {
        assertParentInProject(db, projectId, input.parentId);
      }

      if (input.folderId !== undefined && input.folderId !== null) {
        assertFolderInProject(db, projectId, input.folderId);
      }

      const document = dbCreateDocument(db, {
        projectId,
        title: input.title,
        body: input.body,
        statusLine: input.statusLine,
        parentId: input.parentId,
        folderId: input.folderId,
        linkedTaskId: input.linkedTaskId,
      });

      eventBus.emit({
        type: 'document_created',
        documentId: document.id,
        projectId,
      });

      return serializeDocument(document);
    },

    get(id: string): SerializedDocument | undefined {
      const document = dbGetDocument(db, id);
      if (!document) {
        return undefined;
      }
      return serializeDocument(document);
    },

    update(id: string, input: UpdateDocumentInput): SerializedDocument | undefined {
      const existing = dbGetDocument(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.linkedTaskId !== undefined && input.linkedTaskId !== null) {
        assertTaskInProject(db, existing.projectId, input.linkedTaskId);
      }

      if (input.parentId !== undefined && input.parentId !== null) {
        if (input.parentId === id) {
          throw new InvalidDocumentError('Document cannot be its own parent');
        }
        assertParentInProject(db, existing.projectId, input.parentId);
      }

      if (input.folderId !== undefined && input.folderId !== null) {
        assertFolderInProject(db, existing.projectId, input.folderId);
      }

      const document = dbUpdateDocument(db, id, input);
      if (!document) {
        return undefined;
      }

      return serializeDocument(document);
    },

    getByTask(taskId: string): SerializedDocument | undefined {
      const task = getTask(db, taskId);
      if (!task) {
        return undefined;
      }

      const document = dbGetDocumentByTask(db, taskId);
      if (!document) {
        return undefined;
      }

      return serializeDocument(document);
    },

    delete(id: string) {
      const existing = dbGetDocument(db, id);
      if (!existing) {
        return false;
      }

      db.transaction((tx) => {
        detachDocumentChildren(tx, id);
        deleteCommentsByTarget(tx, 'document', id);
        dbDeleteDocument(tx, id);
      });

      eventBus.emit({ type: 'canvas_updated', projectId: existing.projectId });
      return true;
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
