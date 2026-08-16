import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { artifacts, documents, folders } from '../schema.js';

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

export async function createFolder(db: DbClient, input: NewFolder): Promise<Folder> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
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

export async function getFolder(db: DbClient, id: string): Promise<Folder | undefined> {
  return db.select().from(folders).where(eq(folders.id, id)).get();
}

export async function getFolderByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<Folder | undefined> {
  return db
    .select()
    .from(folders)
    .where(and(eq(folders.projectId, projectId), eq(folders.id, id)))
    .get();
}

export async function listFolders(db: DbClient, projectId: string): Promise<Folder[]> {
  return db.select().from(folders).where(eq(folders.projectId, projectId)).all();
}

export async function updateFolder(
  db: DbClient,
  id: string,
  input: FolderUpdate,
): Promise<Folder | undefined> {
  const now = new Date();
  const rows = await db
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

export async function deleteFolder(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(folders).where(eq(folders.id, id)).run();
  return result.rowsAffected > 0;
}

export async function reparentChildFolders(
  db: DbClient,
  parentFolderId: string,
  newParentFolderId: string | null,
): Promise<number> {
  const result = await db
    .update(folders)
    .set({ parentFolderId: newParentFolderId })
    .where(eq(folders.parentFolderId, parentFolderId))
    .run();
  return result.rowsAffected;
}

export async function moveDocumentsToFolder(
  db: DbClient,
  folderId: string,
  newFolderId: string | null,
): Promise<number> {
  const result = await db
    .update(documents)
    .set({ folderId: newFolderId })
    .where(eq(documents.folderId, folderId))
    .run();
  return result.rowsAffected;
}

export async function moveArtifactsToFolder(
  db: DbClient,
  folderId: string,
  newFolderId: string | null,
): Promise<number> {
  const result = await db
    .update(artifacts)
    .set({ folderId: newFolderId })
    .where(eq(artifacts.folderId, folderId))
    .run();
  return result.rowsAffected;
}

export async function clearFolderParentRefsByProject(
  db: DbClient,
  projectId: string,
): Promise<number> {
  const result = await db
    .update(folders)
    .set({ parentFolderId: null })
    .where(eq(folders.projectId, projectId))
    .run();
  return result.rowsAffected;
}

export async function deleteFoldersByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(folders).where(eq(folders.projectId, projectId)).run();
  return result.rowsAffected;
}
