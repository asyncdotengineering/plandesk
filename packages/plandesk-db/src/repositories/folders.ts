import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { documents, folders } from '../schema.js';

export type Folder = typeof folders.$inferSelect;

export type NewFolder = {
  projectId: string;
  name: string;
  parentFolderId?: string | null;
  id?: string;
};

export type FolderUpdate = {
  name?: string;
  parentFolderId?: string | null;
};

export function createFolder(db: DbClient, input: NewFolder): Folder {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(folders)
    .values({
      id,
      projectId: input.projectId,
      name: input.name,
      parentFolderId: input.parentFolderId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create folder');
  }
  return row;
}

export function getFolder(db: DbClient, id: string): Folder | undefined {
  return db.select().from(folders).where(eq(folders.id, id)).get();
}

export function getFolderByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Folder | undefined {
  return db
    .select()
    .from(folders)
    .where(and(eq(folders.projectId, projectId), eq(folders.id, id)))
    .get();
}

export function listFolders(db: DbClient, projectId: string): Folder[] {
  return db.select().from(folders).where(eq(folders.projectId, projectId)).all();
}

export function updateFolder(db: DbClient, id: string, input: FolderUpdate): Folder | undefined {
  const now = new Date();
  const rows = db
    .update(folders)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(folders.id, id))
    .returning()
    .all();
  return rows[0];
}

export function deleteFolder(db: DbClient, id: string): boolean {
  const result = db.delete(folders).where(eq(folders.id, id)).run();
  return result.changes > 0;
}

export function reparentChildFolders(
  db: DbClient,
  parentFolderId: string,
  newParentFolderId: string | null,
): number {
  const result = db
    .update(folders)
    .set({ parentFolderId: newParentFolderId })
    .where(eq(folders.parentFolderId, parentFolderId))
    .run();
  return result.changes;
}

export function moveDocumentsToFolder(
  db: DbClient,
  folderId: string,
  newFolderId: string | null,
): number {
  const result = db
    .update(documents)
    .set({ folderId: newFolderId })
    .where(eq(documents.folderId, folderId))
    .run();
  return result.changes;
}

export function clearFolderParentRefsByProject(db: DbClient, projectId: string): number {
  const result = db
    .update(folders)
    .set({ parentFolderId: null })
    .where(eq(folders.projectId, projectId))
    .run();
  return result.changes;
}

export function deleteFoldersByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(folders).where(eq(folders.projectId, projectId)).run();
  return result.changes;
}
