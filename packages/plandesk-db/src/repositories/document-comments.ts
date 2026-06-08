import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { documentComments, documents } from '../schema.js';

export type DocumentComment = typeof documentComments.$inferSelect;

export type NewDocumentComment = {
  documentId: string;
  body: string;
  passage?: string | null;
  id?: string;
};

export type DocumentCommentUpdate = {
  body?: string;
  resolved?: boolean;
};

export function createDocumentComment(db: DbClient, input: NewDocumentComment): DocumentComment {
  const id = input.id ?? randomUUID();
  const now = new Date();
  const rows = db
    .insert(documentComments)
    .values({
      id,
      documentId: input.documentId,
      passage: input.passage ?? null,
      body: input.body,
      resolved: false,
      createdAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create document comment');
  }
  return row;
}

export function getDocumentComment(db: DbClient, id: string): DocumentComment | undefined {
  return db.select().from(documentComments).where(eq(documentComments.id, id)).get();
}

export type ListCommentsOptions = {
  includeResolved?: boolean;
};

export function listCommentsByDocument(
  db: DbClient,
  documentId: string,
  options?: ListCommentsOptions,
): DocumentComment[] {
  const conditions = [eq(documentComments.documentId, documentId)];
  if (!options?.includeResolved) {
    conditions.push(eq(documentComments.resolved, false));
  }
  return db
    .select()
    .from(documentComments)
    .where(and(...conditions))
    .orderBy(asc(documentComments.createdAt))
    .all();
}

export function listCommentsByProject(
  db: DbClient,
  projectId: string,
  options?: ListCommentsOptions,
): DocumentComment[] {
  const conditions = [eq(documents.projectId, projectId)];
  if (!options?.includeResolved) {
    conditions.push(eq(documentComments.resolved, false));
  }
  const rows = db
    .select({ comment: documentComments })
    .from(documentComments)
    .innerJoin(documents, eq(documentComments.documentId, documents.id))
    .where(and(...conditions))
    .orderBy(asc(documentComments.createdAt))
    .all();
  return rows.map((row) => row.comment);
}

export function updateDocumentComment(
  db: DbClient,
  id: string,
  input: DocumentCommentUpdate,
): DocumentComment | undefined {
  const rows = db
    .update(documentComments)
    .set(input)
    .where(eq(documentComments.id, id))
    .returning()
    .all();
  return rows[0];
}

export function deleteDocumentComment(db: DbClient, id: string): boolean {
  const result = db.delete(documentComments).where(eq(documentComments.id, id)).run();
  return result.changes > 0;
}

export function deleteCommentsByDocumentId(db: DbClient, documentId: string): number {
  const result = db
    .delete(documentComments)
    .where(eq(documentComments.documentId, documentId))
    .run();
  return result.changes;
}

export function deleteCommentsByProjectId(db: DbClient, projectId: string): number {
  const docIds = db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .all()
    .map((doc) => doc.id);
  if (docIds.length === 0) {
    return 0;
  }
  const result = db
    .delete(documentComments)
    .where(inArray(documentComments.documentId, docIds))
    .run();
  return result.changes;
}
