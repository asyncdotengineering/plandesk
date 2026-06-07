import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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

export function createEdge(db: DbClient, input: NewEdge): Edge {
  const id = input.id ?? randomUUID();
  const rows = db
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

export function getEdge(db: DbClient, id: string): Edge | undefined {
  return db.select().from(edges).where(eq(edges.id, id)).get();
}

export function listEdges(db: DbClient, projectId: string): Edge[] {
  return db.select().from(edges).where(eq(edges.projectId, projectId)).all();
}

export function updateEdge(db: DbClient, id: string, input: EdgeUpdate): Edge | undefined {
  const rows = db.update(edges).set(input).where(eq(edges.id, id)).returning().all();
  return rows[0];
}

export function deleteEdge(db: DbClient, id: string): boolean {
  const result = db.delete(edges).where(eq(edges.id, id)).run();
  return result.changes > 0;
}

export function getEdgeByProjectAndId(
  db: DbClient,
  projectId: string,
  id: string,
): Edge | undefined {
  return db
    .select()
    .from(edges)
    .where(and(eq(edges.projectId, projectId), eq(edges.id, id)))
    .get();
}
