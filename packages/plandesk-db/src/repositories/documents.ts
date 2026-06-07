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
  linkedTaskId?: string | null;
  id?: string;
};

export type DocumentUpdate = {
  title?: string;
  body?: string | null;
  statusLine?: string | null;
  parentId?: string | null;
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

export function listDocuments(db: DbClient, projectId: string): Document[] {
  return db.select().from(documents).where(eq(documents.projectId, projectId)).all();
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
