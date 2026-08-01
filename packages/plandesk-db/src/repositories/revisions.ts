import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { revisions, type RevisionTargetType } from '../schema.js';

export type Revision = typeof revisions.$inferSelect;

export type NewRevision = {
  projectId: string;
  targetType: RevisionTargetType;
  targetId: string;
  snapshot: string;
  changedFields: string;
  author: string;
  createdAt?: Date;
  id?: string;
};

export async function insertRevision(db: DbClient, input: NewRevision): Promise<Revision> {
  const id = input.id ?? randomUUID();
  const now = input.createdAt ?? new Date();
  const rows = await db
    .insert(revisions)
    .values({
      id,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      snapshot: input.snapshot,
      changedFields: input.changedFields,
      author: input.author,
      createdAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to insert revision');
  }
  return row;
}

export async function getRevision(
  db: DbClient,
  id: string,
): Promise<Revision | undefined> {
  return db.select().from(revisions).where(eq(revisions.id, id)).get();
}

export async function listRevisionsByTarget(
  db: DbClient,
  projectId: string,
  targetType: RevisionTargetType,
  targetId: string,
): Promise<Revision[]> {
  return db
    .select()
    .from(revisions)
    .where(
      and(
        eq(revisions.projectId, projectId),
        eq(revisions.targetType, targetType),
        eq(revisions.targetId, targetId),
      ),
    )
    .orderBy(asc(revisions.createdAt))
    .all();
}

export async function deleteRevisionsByTarget(
  db: DbClient,
  targetType: RevisionTargetType,
  targetId: string,
): Promise<number> {
  const result = await db
    .delete(revisions)
    .where(and(eq(revisions.targetType, targetType), eq(revisions.targetId, targetId)))
    .run();
  return result.rowsAffected;
}

export async function deleteRevisionsByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(revisions).where(eq(revisions.projectId, projectId)).run();
  return result.rowsAffected;
}
