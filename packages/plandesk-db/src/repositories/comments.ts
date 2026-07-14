import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { commentTargetTypes, comments, type CommentTargetType } from '../schema.js';

export function isCommentTargetType(value: string): value is CommentTargetType {
  return (commentTargetTypes as readonly string[]).includes(value);
}

export type Comment = typeof comments.$inferSelect;

export type NewComment = {
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  passage?: string | null;
  anchor?: string | null;
  resolved?: boolean;
  createdAt?: Date;
  id?: string;
};

export type CommentUpdate = {
  body?: string;
  resolved?: boolean;
};

export async function createComment(db: DbClient, input: NewComment): Promise<Comment> {
  const id = input.id ?? randomUUID();
  const now = input.createdAt ?? new Date();
  const rows = await db
    .insert(comments)
    .values({
      id,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      passage: input.passage ?? null,
      anchor: input.anchor ?? null,
      body: input.body,
      resolved: input.resolved ?? false,
      createdAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create comment');
  }
  return row;
}

export async function getComment(db: DbClient, id: string): Promise<Comment | undefined> {
  return db.select().from(comments).where(eq(comments.id, id)).get();
}

export type ListCommentsOptions = {
  includeResolved?: boolean;
};

export async function listCommentsByTarget(
  db: DbClient,
  targetType: CommentTargetType,
  targetId: string,
  options?: ListCommentsOptions,
): Promise<Comment[]> {
  const conditions = [eq(comments.targetType, targetType), eq(comments.targetId, targetId)];
  if (!options?.includeResolved) {
    conditions.push(eq(comments.resolved, false));
  }
  return db
    .select()
    .from(comments)
    .where(and(...conditions))
    .orderBy(asc(comments.createdAt))
    .all();
}

export async function listCommentsByProject(
  db: DbClient,
  projectId: string,
  options?: ListCommentsOptions,
): Promise<Comment[]> {
  const conditions = [eq(comments.projectId, projectId)];
  if (!options?.includeResolved) {
    conditions.push(eq(comments.resolved, false));
  }
  return db
    .select()
    .from(comments)
    .where(and(...conditions))
    .orderBy(asc(comments.createdAt))
    .all();
}

export async function updateComment(
  db: DbClient,
  id: string,
  input: CommentUpdate,
): Promise<Comment | undefined> {
  const rows = await db.update(comments).set(input).where(eq(comments.id, id)).returning().all();
  return rows[0];
}

export async function deleteComment(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(comments).where(eq(comments.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deleteCommentsByTarget(
  db: DbClient,
  targetType: CommentTargetType,
  targetId: string,
): Promise<number> {
  const result = await db
    .delete(comments)
    .where(and(eq(comments.targetType, targetType), eq(comments.targetId, targetId)))
    .run();
  return result.rowsAffected;
}

export async function deleteCommentsByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(comments).where(eq(comments.projectId, projectId)).run();
  return result.rowsAffected;
}
