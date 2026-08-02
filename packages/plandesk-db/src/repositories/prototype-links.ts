import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { prototypeLinks } from '../schema.js';

export type PrototypeLink = typeof prototypeLinks.$inferSelect;

export type NewPrototypeLink = {
  projectId: string;
  fromArtifactId: string;
  toArtifactId: string | null;
  rawTarget: string;
  id?: string;
};

export async function createPrototypeLink(
  db: DbClient,
  input: NewPrototypeLink,
): Promise<PrototypeLink> {
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(prototypeLinks)
    .values({
      id,
      projectId: input.projectId,
      fromArtifactId: input.fromArtifactId,
      toArtifactId: input.toArtifactId,
      rawTarget: input.rawTarget,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create prototype link');
  }
  return row;
}

export async function deletePrototypeLinksByFromArtifact(
  db: DbClient,
  fromArtifactId: string,
): Promise<number> {
  const result = await db
    .delete(prototypeLinks)
    .where(eq(prototypeLinks.fromArtifactId, fromArtifactId))
    .run();
  return result.rowsAffected;
}

export async function listPrototypeLinksByProject(
  db: DbClient,
  projectId: string,
): Promise<PrototypeLink[]> {
  return db.select().from(prototypeLinks).where(eq(prototypeLinks.projectId, projectId)).all();
}

export async function listPrototypeLinksByFromArtifact(
  db: DbClient,
  fromArtifactId: string,
): Promise<PrototypeLink[]> {
  return db
    .select()
    .from(prototypeLinks)
    .where(eq(prototypeLinks.fromArtifactId, fromArtifactId))
    .all();
}

export async function listNullPrototypeLinksByProject(
  db: DbClient,
  projectId: string,
): Promise<PrototypeLink[]> {
  return db
    .select()
    .from(prototypeLinks)
    .where(and(eq(prototypeLinks.projectId, projectId), isNull(prototypeLinks.toArtifactId)))
    .all();
}

export async function updatePrototypeLinkTarget(
  db: DbClient,
  id: string,
  toArtifactId: string | null,
): Promise<PrototypeLink | undefined> {
  const rows = await db
    .update(prototypeLinks)
    .set({ toArtifactId })
    .where(eq(prototypeLinks.id, id))
    .returning()
    .all();
  return rows[0];
}

export async function deletePrototypeLinksByProjectId(
  db: DbClient,
  projectId: string,
): Promise<number> {
  const result = await db
    .delete(prototypeLinks)
    .where(eq(prototypeLinks.projectId, projectId))
    .run();
  return result.rowsAffected;
}
