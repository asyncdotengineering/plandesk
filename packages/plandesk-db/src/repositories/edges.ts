import { randomUUID } from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { edges, type LinkEntityType } from '../schema.js';

export type Edge = typeof edges.$inferSelect;

export type NewEdge = {
  projectId: string;
  /** Task-shaped endpoints (legacy callers). Mapped to type `task` when typed fields are omitted. */
  fromTaskId?: string;
  toTaskId?: string;
  /** Typed endpoints. When both are `task`, legacy columns are dual-written. */
  fromType?: LinkEntityType;
  fromId?: string;
  toType?: LinkEntityType;
  toId?: string;
  label?: string | null;
  arrowDirection?: string | null;
  style?: string | null;
  id?: string;
};

export type EdgeUpdate = {
  fromTaskId?: string;
  toTaskId?: string;
  fromType?: LinkEntityType | null;
  fromId?: string | null;
  toType?: LinkEntityType | null;
  toId?: string | null;
  label?: string | null;
  arrowDirection?: string | null;
  style?: string | null;
};

export type EdgeEndpoints = {
  fromType: LinkEntityType;
  fromId: string;
  toType: LinkEntityType;
  toId: string;
};

/**
 * Resolve typed + legacy column values for an insert.
 *
 * Dual-write (task→task only): from_task_id/to_task_id mirror the typed pair.
 * Document endpoints: typed columns hold the relationship; legacy columns get
 * the expand-era self-edge scaffold on a task endpoint so NOT NULL + FK still hold.
 * Contract step drops the legacy pair entirely.
 */
function resolveEdgeColumns(input: NewEdge): {
  fromType: LinkEntityType;
  fromId: string;
  toType: LinkEntityType;
  toId: string;
  fromTaskId: string | null;
  toTaskId: string | null;
} {
  const fromType: LinkEntityType | undefined =
    input.fromType ?? (input.fromTaskId !== undefined ? 'task' : undefined);
  const toType: LinkEntityType | undefined =
    input.toType ?? (input.toTaskId !== undefined ? 'task' : undefined);
  const fromId = input.fromId ?? input.fromTaskId;
  const toId = input.toId ?? input.toTaskId;

  if (
    fromType === undefined ||
    toType === undefined ||
    fromId === undefined ||
    toId === undefined
  ) {
    throw new Error('Edge requires from/to endpoints (typed or task-shaped)');
  }

  if (fromType === 'task' && toType === 'task') {
    return {
      fromType,
      fromId,
      toType,
      toId,
      fromTaskId: fromId,
      toTaskId: toId,
    };
  }

  // Any document endpoint: the legacy pair names no task, so it stays null.
  // Inventing a task id here would write a meaningless value that old readers
  // render as a self-edge on an unrelated task.
  return {
    fromType,
    fromId,
    toType,
    toId,
    fromTaskId: null,
    toTaskId: null,
  };
}

export async function createEdge(db: DbClient, input: NewEdge): Promise<Edge> {
  const id = input.id ?? randomUUID();
  const cols = resolveEdgeColumns(input);
  const rows = await db
    .insert(edges)
    .values({
      id,
      projectId: input.projectId,
      fromTaskId: cols.fromTaskId,
      toTaskId: cols.toTaskId,
      fromType: cols.fromType,
      fromId: cols.fromId,
      toType: cols.toType,
      toId: cols.toId,
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

export async function getEdgeByEndpoints(
  db: DbClient,
  projectId: string,
  endpoints: EdgeEndpoints,
): Promise<Edge | undefined> {
  return db
    .select()
    .from(edges)
    .where(
      and(
        eq(edges.projectId, projectId),
        eq(edges.fromType, endpoints.fromType),
        eq(edges.fromId, endpoints.fromId),
        eq(edges.toType, endpoints.toType),
        eq(edges.toId, endpoints.toId),
      ),
    )
    .get();
}

export async function listEdgesByEndpoint(
  db: DbClient,
  projectId: string,
  type: LinkEntityType,
  id: string,
): Promise<Edge[]> {
  return db
    .select()
    .from(edges)
    .where(
      and(
        eq(edges.projectId, projectId),
        or(
          and(eq(edges.fromType, type), eq(edges.fromId, id)),
          and(eq(edges.toType, type), eq(edges.toId, id)),
        ),
      ),
    )
    .all();
}

export async function updateEdge(
  db: DbClient,
  id: string,
  input: EdgeUpdate,
): Promise<Edge | undefined> {
  // When task endpoints move, dual-write typed columns so readers stay consistent.
  const patch: EdgeUpdate = { ...input };
  if (input.fromTaskId !== undefined && input.fromType === undefined && input.fromId === undefined) {
    patch.fromType = 'task';
    patch.fromId = input.fromTaskId;
  }
  if (input.toTaskId !== undefined && input.toType === undefined && input.toId === undefined) {
    patch.toType = 'task';
    patch.toId = input.toTaskId;
  }
  const rows = await db.update(edges).set(patch).where(eq(edges.id, id)).returning().all();
  return rows[0];
}

export async function deleteEdge(db: DbClient, id: string): Promise<boolean> {
  const result = await db.delete(edges).where(eq(edges.id, id)).run();
  return result.rowsAffected > 0;
}

export async function deleteEdgeByEndpoints(
  db: DbClient,
  projectId: string,
  endpoints: EdgeEndpoints,
): Promise<boolean> {
  const result = await db
    .delete(edges)
    .where(
      and(
        eq(edges.projectId, projectId),
        eq(edges.fromType, endpoints.fromType),
        eq(edges.fromId, endpoints.fromId),
        eq(edges.toType, endpoints.toType),
        eq(edges.toId, endpoints.toId),
      ),
    )
    .run();
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
    .where(
      or(
        eq(edges.fromTaskId, taskId),
        eq(edges.toTaskId, taskId),
        and(eq(edges.fromType, 'task'), eq(edges.fromId, taskId)),
        and(eq(edges.toType, 'task'), eq(edges.toId, taskId)),
      ),
    )
    .run();
  return result.rowsAffected;
}

export async function deleteEdgesByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(edges).where(eq(edges.projectId, projectId)).run();
  return result.rowsAffected;
}
