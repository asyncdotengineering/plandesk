import {
  withTransaction,
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
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
export type DocumentServiceDeps = OrgScopedDeps & {
  db: Db;
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

async function assertTaskInProject(db: Db, projectId: string, taskId: string): Promise<void> {
  const task = await getTask(db, taskId);
  if (!task || task.projectId !== projectId) {
    throw new InvalidDocumentError('Task does not belong to project');
  }
}

async function assertParentInProject(db: Db, projectId: string, parentId: string): Promise<void> {
  const parent = await dbGetDocument(db, parentId);
  if (!parent || parent.projectId !== projectId) {
    throw new InvalidDocumentError('Parent document does not belong to project');
  }
}

async function assertFolderInProject(db: Db, projectId: string, folderId: string): Promise<void> {
  if (!(await getFolderByProjectAndId(db, projectId, folderId))) {
    throw new InvalidDocumentError('Folder does not belong to project');
  }
}

export function createDocumentService(deps: DocumentServiceDeps) {
  const { db } = deps;

  return {
    async listTree(
      projectId: string,
      pagination: PaginationParams = {},
    ): Promise<SerializedDocumentTree[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return buildDocumentTree(await dbListDocuments(db, projectId, pagination));
    },

    async listFolderTree(projectId: string): Promise<SerializedDocumentFolderTree | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return buildFolderTree(
        await dbListFolders(db, projectId),
        await dbListDocuments(db, projectId),
      );
    },

    async listByFolder(
      projectId: string,
      folderId: string,
    ): Promise<SerializedDocumentTree[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      if (!(await getFolderByProjectAndId(db, projectId, folderId))) {
        return undefined;
      }
      return buildDocumentTree(await dbListDocuments(db, projectId, { folderId }));
    },

    async create(
      projectId: string,
      input: CreateDocumentInput,
    ): Promise<SerializedDocument | undefined> {
      assertPermission(deps, 'document', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.linkedTaskId !== undefined && input.linkedTaskId !== null) {
        await assertTaskInProject(db, projectId, input.linkedTaskId);
      }

      if (input.parentId !== undefined && input.parentId !== null) {
        await assertParentInProject(db, projectId, input.parentId);
      }

      if (input.folderId !== undefined && input.folderId !== null) {
        await assertFolderInProject(db, projectId, input.folderId);
      }

      const document = await dbCreateDocument(db, {
        projectId,
        title: input.title,
        body: input.body,
        statusLine: input.statusLine,
        parentId: input.parentId,
        folderId: input.folderId,
        linkedTaskId: input.linkedTaskId,
      });

      return serializeDocument(document);
    },

    async get(id: string): Promise<SerializedDocument | undefined> {
      const document = await dbGetDocument(db, id);
      if (!document) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, document.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return serializeDocument(document);
    },

    async update(id: string, input: UpdateDocumentInput): Promise<SerializedDocument | undefined> {
      assertPermission(deps, 'document', 'update');
      const existing = await dbGetDocument(db, id);
      if (!existing) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      if (input.linkedTaskId !== undefined && input.linkedTaskId !== null) {
        await assertTaskInProject(db, existing.projectId, input.linkedTaskId);
      }

      if (input.parentId !== undefined && input.parentId !== null) {
        if (input.parentId === id) {
          throw new InvalidDocumentError('Document cannot be its own parent');
        }
        await assertParentInProject(db, existing.projectId, input.parentId);
      }

      if (input.folderId !== undefined && input.folderId !== null) {
        await assertFolderInProject(db, existing.projectId, input.folderId);
      }

      const document = await dbUpdateDocument(db, id, input);
      if (!document) {
        return undefined;
      }

      return serializeDocument(document);
    },

    async getByTask(taskId: string): Promise<SerializedDocument | undefined> {
      const task = await getTask(db, taskId);
      if (!task) {
        return undefined;
      }

      const document = await dbGetDocumentByTask(db, taskId);
      if (!document) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, document.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      return serializeDocument(document);
    },

    async delete(id: string) {
      assertPermission(deps, 'document', 'delete');
      const existing = await dbGetDocument(db, id);
      if (!existing) {
        return false;
      }
      try {
        await assertProjectInOrg(db, existing.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return false;
        }
        throw error;
      }

      await withTransaction(db, async (tx) => {
        await detachDocumentChildren(tx, id);
        await deleteCommentsByTarget(tx, 'document', id);
        await dbDeleteDocument(tx, id);
      });

      return true;
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
