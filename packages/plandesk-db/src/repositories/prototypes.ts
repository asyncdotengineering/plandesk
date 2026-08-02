import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { prototypes } from '../schema.js';

export type Prototype = typeof prototypes.$inferSelect;

export type NewPrototype = {
  projectId: string;
  name: string;
  viewportWidth: number;
  viewportHeight: number;
  id?: string;
};

export type PrototypeUpdate = {
  name?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

export async function createPrototype(db: DbClient, input: NewPrototype): Promise<Prototype> {
  const now = new Date();
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(prototypes)
    .values({
      id,
      projectId: input.projectId,
      name: input.name,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create prototype');
  }
  return row;
}

export async function getPrototype(db: DbClient, id: string): Promise<Prototype | undefined> {
  return db.select().from(prototypes).where(eq(prototypes.id, id)).get();
}

export async function getPrototypeByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<Prototype | undefined> {
  return db
    .select()
    .from(prototypes)
    .where(and(eq(prototypes.projectId, projectId), eq(prototypes.id, id)))
    .get();
}

export async function listPrototypes(db: DbClient, projectId: string): Promise<Prototype[]> {
  return db.select().from(prototypes).where(eq(prototypes.projectId, projectId)).all();
}

export async function updatePrototype(
  db: DbClient,
  id: string,
  input: PrototypeUpdate,
): Promise<Prototype | undefined> {
  const now = new Date();
  const rows = await db
    .update(prototypes)
    .set({
      ...input,
      updatedAt: now,
    })
    .where(eq(prototypes.id, id))
    .returning()
    .all();
  return rows[0];
}

export async function deletePrototype(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(prototypes).where(eq(prototypes.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deletePrototypesByProjectId(
  db: DbClient,
  projectId: string,
): Promise<number> {
  const result = await db.delete(prototypes).where(eq(prototypes.projectId, projectId)).run();
  return result.rowsAffected;
}
