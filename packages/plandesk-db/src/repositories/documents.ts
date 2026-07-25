import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { documents } from '../schema.js';
import { listEdgesByEndpoint } from './edges.js';

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

export async function createDocument(db: DbClient, input: NewDocument): Promise<Document> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
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

export async function getDocument(db: DbClient, id: string): Promise<Document | undefined> {
  return db.select().from(documents).where(eq(documents.id, id)).get();
}

export type ListDocumentsOptions = {
  limit?: number;
  offset?: number;
  folderId?: string;
};

export async function listDocuments(
  db: DbClient,
  projectId: string,
  options?: ListDocumentsOptions,
): Promise<Document[]> {
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

/**
 * Every document in `projectId` linked to `taskId`, via the legacy
 * `linked_task_id` column and/or a `document → task` edge. Project-scoped only.
 */
export async function listDocumentsLinkedToTask(
  db: DbClient,
  projectId: string,
  taskId: string,
): Promise<Document[]> {
  const linkedIds = new Set<string>();

  const legacy = await db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.linkedTaskId, taskId)))
    .all();
  for (const doc of legacy) {
    linkedIds.add(doc.id);
  }

  const edges = await listEdgesByEndpoint(db, projectId, 'task', taskId);
  for (const edge of edges) {
    if (
      edge.fromType === 'document' &&
      edge.fromId !== null &&
      edge.toType === 'task' &&
      edge.toId === taskId
    ) {
      linkedIds.add(edge.fromId);
    }
  }

  if (linkedIds.size === 0) {
    return [];
  }

  // Re-fetch by id so edge-only docs are included, still scoped to the project.
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), inArray(documents.id, [...linkedIds])))
    .all();
}

/**
 * Singular primary document for a task (legacy API shape).
 * Prefers the document whose `linked_task_id` is this task; otherwise the
 * oldest edge-linked document in the project (createdAt, then id).
 */
export async function getDocumentByTask(
  db: DbClient,
  projectId: string,
  taskId: string,
): Promise<Document | undefined> {
  const linked = await listDocumentsLinkedToTask(db, projectId, taskId);
  if (linked.length === 0) {
    return undefined;
  }
  const legacy = linked.find((doc) => doc.linkedTaskId === taskId);
  if (legacy) {
    return legacy;
  }
  return [...linked].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  })[0];
}

export async function getDocumentByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<Document | undefined> {
  return db
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.id, id)))
    .get();
}

export async function updateDocument(
  db: DbClient,
  id: string,
  input: DocumentUpdate,
): Promise<Document | undefined> {
  const now = new Date();
  const rows = await db
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

export async function deleteDocument(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(documents).where(eq(documents.id, id)).run();
  return result.rowsAffected > 0;
}

export async function detachDocumentChildren(db: DbClient, parentId: string): Promise<number> {
  const result = await db
    .update(documents)
    .set({ parentId: null })
    .where(eq(documents.parentId, parentId))
    .run();
  return result.rowsAffected;
}

export async function nullDocumentsLinkedTask(db: DbClient, taskId: string): Promise<number> {
  const result = await db
    .update(documents)
    .set({ linkedTaskId: null })
    .where(eq(documents.linkedTaskId, taskId))
    .run();
  return result.rowsAffected;
}

export async function clearDocumentParentRefsByProject(
  db: DbClient,
  projectId: string,
): Promise<number> {
  const result = await db
    .update(documents)
    .set({ parentId: null })
    .where(eq(documents.projectId, projectId))
    .run();
  return result.rowsAffected;
}

export async function deleteDocumentsByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(documents).where(eq(documents.projectId, projectId)).run();
  return result.rowsAffected;
}
