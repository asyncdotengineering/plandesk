import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { documents } from '../schema.js';

export type Document = typeof documents.$inferSelect;

export type NewDocument = {
  projectId: string;
  title: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
  folderId?: string | null;
  linkedTaskId?: string | null;
  id?: string;
};

export type DocumentUpdate = {
  title?: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
  folderId?: string | null;
  linkedTaskId?: string | null;
};

export function createDocument(db: DbClient, input: NewDocument): Document {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = db
    .insert(documents)
    .values({
      id,
      projectId: input.projectId,
      title: input.title,
      body: input.body ?? null,
      statusLine: input.statusLine ?? null,
      parentId: input.parentId ?? null,
      folderId: input.folderId ?? null,
      linkedTaskId: input.linkedTaskId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create document');
  }
  return row;
}

export function getDocument(db: DbClient, id: string): Document | undefined {
  return db.select().from(documents).where(eq(documents.id, id)).get();
}

export type ListDocumentsOptions = {
  limit?: number;
  offset?: number;
  folderId?: string;
};

export function listDocuments(
  db: DbClient,
  projectId: string,
  options?: ListDocumentsOptions,
): Document[] {
  const where =
    options?.folderId !== undefined
      ? and(eq(documents.projectId, projectId), eq(documents.folderId, options.folderId))
      : eq(documents.projectId, projectId);
  let query = db.select().from(documents).where(where).$dynamic();
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options?.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export function getDocumentByTask(db: DbClient, taskId: string): Document | undefined {
  return db.select().from(documents).where(eq(documents.linkedTaskId, taskId)).get();
}

export function getDocumentByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Document | undefined {
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.id, id)))
    .get();
}

export function updateDocument(
  db: DbClient,
  id: string,
  input: DocumentUpdate,
): Document | undefined {
  const now = new Date();
  const rows = db
    .update(documents)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(documents.id, id))
    .returning()
    .all();
  return rows[0];
}

export function deleteDocument(db: DbClient, id: string): boolean {
  const result = db.delete(documents).where(eq(documents.id, id)).run();
  return result.changes > 0;
}

export function detachDocumentChildren(db: DbClient, parentId: string): number {
  const result = db
    .update(documents)
    .set({ parentId: null })
    .where(eq(documents.parentId, parentId))
    .run();
  return result.changes;
}

export function nullDocumentsLinkedTask(db: DbClient, taskId: string): number {
  const result = db
    .update(documents)
    .set({ linkedTaskId: null })
    .where(eq(documents.linkedTaskId, taskId))
    .run();
  return result.changes;
}

export function clearDocumentParentRefsByProject(db: DbClient, projectId: string): number {
  const result = db
    .update(documents)
    .set({ parentId: null })
    .where(eq(documents.projectId, projectId))
    .run();
  return result.changes;
}

export function deleteDocumentsByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(documents).where(eq(documents.projectId, projectId)).run();
  return result.changes;
}
