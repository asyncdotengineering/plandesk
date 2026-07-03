import {
  createFolder as dbCreateFolder,
  deleteFolder as dbDeleteFolder,
  getFolder as dbGetFolder,
  getProject,
  listFolders as dbListFolders,
  moveDocumentsToFolder,
  reparentChildFolders,
  updateFolder as dbUpdateFolder,
  type Db,
} from '@plandesk/db';
import { serializeFolder, type SerializedFolder } from '../serialize.js';
import type { EventBus } from '../events.js';

export type FolderServiceDeps = {
  db: Db;
  eventBus: EventBus;
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

function assertParentInProject(db: Db, projectId: string, parentFolderId: string): void {
  const parent = dbGetFolder(db, parentFolderId);
  if (!parent || parent.projectId !== projectId) {
    throw new InvalidFolderError('Parent folder does not belong to project');
  }
}

function assertNoCycle(db: Db, folderId: string, newParentFolderId: string): void {
  const visited = new Set<string>();
  let current: string | null = newParentFolderId;
  while (current !== null) {
    if (current === folderId) {
      throw new InvalidFolderError('Re-parenting would create a folder cycle');
    }
    if (visited.has(current)) {
      return;
    }
    visited.add(current);
    current = dbGetFolder(db, current)?.parentFolderId ?? null;
  }
}

export function createFolderService(deps: FolderServiceDeps) {
  const { db, eventBus } = deps;

  return {
    list(projectId: string): SerializedFolder[] | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }
      return dbListFolders(db, projectId).map(serializeFolder);
    },

    create(projectId: string, input: CreateFolderInput): SerializedFolder | undefined {
      const project = getProject(db, projectId);
      if (!project) {
        return undefined;
      }

      assertNonEmptyName(input.name);
      if (input.parentFolderId !== undefined && input.parentFolderId !== null) {
        assertParentInProject(db, projectId, input.parentFolderId);
      }

      const folder = dbCreateFolder(db, {
        projectId,
        name: input.name,
        parentFolderId: input.parentFolderId,
      });

      eventBus.emit({ type: 'folder_created', folderId: folder.id, projectId });

      return serializeFolder(folder);
    },

    get(id: string): SerializedFolder | undefined {
      const folder = dbGetFolder(db, id);
      if (!folder) {
        return undefined;
      }
      return serializeFolder(folder);
    },

    update(id: string, input: UpdateFolderInput): SerializedFolder | undefined {
      const existing = dbGetFolder(db, id);
      if (!existing) {
        return undefined;
      }

      if (input.name !== undefined) {
        assertNonEmptyName(input.name);
      }

      if (input.parentFolderId !== undefined && input.parentFolderId !== null) {
        if (input.parentFolderId === id) {
          throw new InvalidFolderError('Folder cannot be its own parent');
        }
        assertParentInProject(db, existing.projectId, input.parentFolderId);
        assertNoCycle(db, id, input.parentFolderId);
      }

      const folder = dbUpdateFolder(db, id, input);
      if (!folder) {
        return undefined;
      }

      eventBus.emit({ type: 'folder_updated', folderId: folder.id, projectId: folder.projectId });

      return serializeFolder(folder);
    },

    delete(id: string): boolean {
      const existing = dbGetFolder(db, id);
      if (!existing) {
        return false;
      }

      // Never orphan: children folders and contained documents move to the
      // deleted folder's parent (or root when the folder was at root).
      db.transaction((tx) => {
        reparentChildFolders(tx, id, existing.parentFolderId);
        moveDocumentsToFolder(tx, id, existing.parentFolderId);
        dbDeleteFolder(tx, id);
      });

      eventBus.emit({ type: 'folder_updated', folderId: id, projectId: existing.projectId });
      return true;
    },
  };
}

export type FolderService = ReturnType<typeof createFolderService>;
