import {
  withTransaction,
  createFolder as dbCreateFolder,
  deleteFolder as dbDeleteFolder,
  getFolder as dbGetFolder,
  listFolders as dbListFolders,
  moveDocumentsToFolder,
  reparentChildFolders,
  updateFolder as dbUpdateFolder,
  type Db,
} from '@plandesk/db';
import { serializeFolder, type SerializedFolder } from '../serialize.js';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
import {
  FOLDER_REPARENT_CYCLE_MESSAGE,
  wouldCreateFolderReparentCycle,
} from './folder-cycle.js';

export type FolderServiceDeps = OrgScopedDeps & {
  db: Db;
};

export type CreateFolderInput = {
  name: string;
  parentFolderId?: string | null;
};

export type UpdateFolderInput = {
  name?: string;
  parentFolderId?: string | null;
};

export class InvalidFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFolderError';
  }
}

function assertNonEmptyName(name: string): void {
  if (name.trim() === '') {
    throw new InvalidFolderError('Folder name must not be empty');
  }
}

async function assertParentInProject(
  db: Db,
  projectId: string,
  parentFolderId: string,
): Promise<void> {
  const parent = await dbGetFolder(db, parentFolderId);
  if (!parent || parent.projectId !== projectId) {
    throw new InvalidFolderError('Parent folder does not belong to project');
  }
}

async function assertNoCycle(db: Db, folderId: string, newParentFolderId: string): Promise<void> {
  const parentById = new Map<string, string | null>();
  let current: string | null = newParentFolderId;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    if (!parentById.has(current)) {
      parentById.set(current, (await dbGetFolder(db, current))?.parentFolderId ?? null);
    }
    current = parentById.get(current) ?? null;
  }
  if (
    wouldCreateFolderReparentCycle(folderId, newParentFolderId, (id) => parentById.get(id) ?? null)
  ) {
    throw new InvalidFolderError(FOLDER_REPARENT_CYCLE_MESSAGE);
  }
}

export function createFolderService(deps: FolderServiceDeps) {
  const { db } = deps;

  return {
    async list(projectId: string): Promise<SerializedFolder[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await dbListFolders(db, projectId)).map(serializeFolder);
    },

    async create(
      projectId: string,
      input: CreateFolderInput,
    ): Promise<SerializedFolder | undefined> {
      assertPermission(deps, 'document', 'create');
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }

      assertNonEmptyName(input.name);
      if (input.parentFolderId !== undefined && input.parentFolderId !== null) {
        await assertParentInProject(db, projectId, input.parentFolderId);
      }

      const folder = await dbCreateFolder(db, {
        projectId,
        name: input.name,
        parentFolderId: input.parentFolderId,
      });

      return serializeFolder(folder);
    },

    async get(id: string): Promise<SerializedFolder | undefined> {
      const folder = await dbGetFolder(db, id);
      if (!folder) {
        return undefined;
      }
      try {
        await assertProjectInOrg(db, folder.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return serializeFolder(folder);
    },

    async update(id: string, input: UpdateFolderInput): Promise<SerializedFolder | undefined> {
      assertPermission(deps, 'document', 'update');
      const existing = await dbGetFolder(db, id);
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

      if (input.name !== undefined) {
        assertNonEmptyName(input.name);
      }

      if (input.parentFolderId !== undefined && input.parentFolderId !== null) {
        if (input.parentFolderId === id) {
          throw new InvalidFolderError('Folder cannot be its own parent');
        }
        await assertParentInProject(db, existing.projectId, input.parentFolderId);
        await assertNoCycle(db, id, input.parentFolderId);
      }

      const folder = await dbUpdateFolder(db, id, input);
      if (!folder) {
        return undefined;
      }

      return serializeFolder(folder);
    },

    async delete(
      id: string,
      options?: { reparentTo?: string | null },
    ): Promise<boolean> {
      assertPermission(deps, 'document', 'delete');
      const existing = await dbGetFolder(db, id);
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

      // Default: reparent to the deleted folder's parent (null == Unfiled).
      // Explicit reparentTo (including null) overrides that choice.
      let target: string | null;
      if (options !== undefined && 'reparentTo' in options) {
        target = options.reparentTo ?? null;
        if (target === id) {
          throw new InvalidFolderError('Cannot reparent contents into the folder being deleted');
        }
        if (target !== null) {
          await assertParentInProject(db, existing.projectId, target);
          await assertNoCycle(db, id, target);
        }
      } else {
        target = existing.parentFolderId;
      }

      // Never orphan: child folders and contained documents move to target.
      await withTransaction(db, async (tx) => {
        await reparentChildFolders(tx, id, target);
        await moveDocumentsToFolder(tx, id, target);
        await dbDeleteFolder(tx, id);
      });

      return true;
    },
  };
}

export type FolderService = ReturnType<typeof createFolderService>;
