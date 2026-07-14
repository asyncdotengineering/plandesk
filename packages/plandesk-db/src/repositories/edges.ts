import { randomUUID } from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { edges } from '../schema.js';

export type Edge = typeof edges.$inferSelect;

export type NewEdge = {
  projectId: string;
  fromTaskId: string;
  toTaskId: string;
  label?: string | null;
  arrowDirection?: string | null;
  style?: string | null;
  id?: string;
};

export type EdgeUpdate = {
  fromTaskId?: string;
  toTaskId?: string;
  label?: string | null;
  arrowDirection?: string | null;
  style?: string | null;
};

export async function createEdge(db: DbClient, input: NewEdge): Promise<Edge> {
  const id = input.id ?? randomUUID();
  const rows = await db
    .insert(edges)
    .values({
      id,
      projectId: input.projectId,
      fromTaskId: input.fromTaskId,
      toTaskId: input.toTaskId,
      label: input.label ?? null,
      arrowDirection: input.arrowDirection ?? null,
      style: input.style ?? null,
    })
    .returning()
    .all();
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create edge');
  }
  return row;
}

export async function getEdge(db: DbClient, id: string): Promise<Edge | undefined> {
  return db.select().from(edges).where(eq(edges.id, id)).get();
}

export async function listEdges(db: DbClient, projectId: string): Promise<Edge[]> {
  return db.select().from(edges).where(eq(edges.projectId, projectId)).all();
}

export async function updateEdge(
  db: DbClient,
  id: string,
  input: EdgeUpdate,
): Promise<Edge | undefined> {
  const rows = await db.update(edges).set(input).where(eq(edges.id, id)).returning().all();
  return rows[0];
}

export async function deleteEdge(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(edges).where(eq(edges.id, id)).run();
  return result.rowsAffected > 0;
}

export async function getEdgeByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Promise<Edge | undefined> {
  return db
    .select()
    .from(edges)
    .where(and(eq(edges.projectId, projectId), eq(edges.id, id)))
    .get();
}

export async function deleteEdgesByTaskId(db: DbClient, taskId: string): Promise<number> {
  const result = await db
    .delete(edges)
    .where(or(eq(edges.fromTaskId, taskId), eq(edges.toTaskId, taskId)))
    .run();
  return result.rowsAffected;
}

export async function deleteEdgesByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(edges).where(eq(edges.projectId, projectId)).run();
  return result.rowsAffected;
}
