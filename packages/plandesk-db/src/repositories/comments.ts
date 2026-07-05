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
  resolved?: boolean;
  createdAt?: Date;
  id?: string;
};

export type CommentUpdate = {
  body?: string;
  resolved?: boolean;
};

export function createComment(db: DbClient, input: NewComment): Comment {
  const id = input.id ?? randomUUID();
  const now = input.createdAt ?? new Date();
  const rows = db
    .insert(comments)
    .values({
      id,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      passage: input.passage ?? null,
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

export function getComment(db: DbClient, id: string): Comment | undefined {
  return db.select().from(comments).where(eq(comments.id, id)).get();
}

export type ListCommentsOptions = {
  includeResolved?: boolean;
};

export function listCommentsByTarget(
  db: DbClient,
  targetType: CommentTargetType,
  targetId: string,
  options?: ListCommentsOptions,
): Comment[] {
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

export function listCommentsByProject(
  db: DbClient,
  projectId: string,
  options?: ListCommentsOptions,
): Comment[] {
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

export function updateComment(db: DbClient, id: string, input: CommentUpdate): Comment | undefined {
  const rows = db.update(comments).set(input).where(eq(comments.id, id)).returning().all();
  return rows[0];
}

export function deleteComment(db: DbClient, id: string): boolean {
  const result = db.delete(comments).where(eq(comments.id, id)).run();
  return result.changes > 0;
}

export function deleteCommentsByTarget(
  db: DbClient,
  targetType: CommentTargetType,
  targetId: string,
): number {
  const result = db
    .delete(comments)
    .where(and(eq(comments.targetType, targetType), eq(comments.targetId, targetId)))
    .run();
  return result.changes;
}

export function deleteCommentsByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(comments).where(eq(comments.projectId, projectId)).run();
  return result.changes;
}
