import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { Db, DbClient } from '../client.js';
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

export type RevisionTargetUsage = {
  projectId: string;
  targetType: RevisionTargetType;
  targetId: string;
  revisionCount: number;
  snapshotBytes: number;
};

/** Snapshot storage vs database size — enough to decide whether to set a cap. */
export type RevisionUsageReport = {
  revisionCount: number;
  snapshotBytes: number;
  databaseBytes: number;
  /** `snapshotBytes / databaseBytes`, or `0` when the database reports zero bytes. */
  snapshotShareOfDatabase: number;
  perTarget: RevisionTargetUsage[];
};

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

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

export async function getRevision(db: DbClient, id: string): Promise<Revision | undefined> {
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

/** Newest revision id for a target, or undefined when none exist. */
export async function getLatestRevisionId(
  db: DbClient,
  projectId: string,
  targetType: RevisionTargetType,
  targetId: string,
): Promise<string | undefined> {
  const row = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(
      and(
        eq(revisions.projectId, projectId),
        eq(revisions.targetType, targetType),
        eq(revisions.targetId, targetId),
      ),
    )
    .orderBy(desc(revisions.createdAt), desc(revisions.id))
    .limit(1)
    .get();
  return row?.id;
}

/**
 * Keep the newest `cap` revisions for one target; delete older ones.
 * Call inside the same transaction as the insert that may have exceeded the cap.
 */
export async function evictRevisionsBeyondCap(
  db: DbClient,
  targetType: RevisionTargetType,
  targetId: string,
  cap: number,
): Promise<number> {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`evictRevisionsBeyondCap requires a positive integer cap; got ${String(cap)}`);
  }
  const keep = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(and(eq(revisions.targetType, targetType), eq(revisions.targetId, targetId)))
    .orderBy(desc(revisions.createdAt), desc(revisions.id))
    .limit(cap)
    .all();
  if (keep.length === 0) {
    return 0;
  }
  const keepIds = keep.map((row) => row.id);
  const result = await db
    .delete(revisions)
    .where(
      and(
        eq(revisions.targetType, targetType),
        eq(revisions.targetId, targetId),
        notInArray(revisions.id, keepIds),
      ),
    )
    .run();
  return result.rowsAffected;
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

/** Revision count, snapshot bytes per target, and share of the database file. */
export async function reportRevisionUsage(db: Db): Promise<RevisionUsageReport> {
  const totals = await db
    .select({
      revisionCount: sql<number>`count(*)`.mapWith(Number),
      snapshotBytes: sql<number>`coalesce(sum(length(${revisions.snapshot})), 0)`.mapWith(Number),
    })
    .from(revisions)
    .all();
  const totalRow = totals[0];
  const revisionCount = totalRow?.revisionCount ?? 0;
  const snapshotBytes = totalRow?.snapshotBytes ?? 0;

  const perTargetRows = await db
    .select({
      projectId: revisions.projectId,
      targetType: revisions.targetType,
      targetId: revisions.targetId,
      revisionCount: sql<number>`count(*)`.mapWith(Number),
      snapshotBytes: sql<number>`coalesce(sum(length(${revisions.snapshot})), 0)`.mapWith(Number),
    })
    .from(revisions)
    .groupBy(revisions.projectId, revisions.targetType, revisions.targetId)
    .orderBy(
      desc(sql`coalesce(sum(length(${revisions.snapshot})), 0)`),
      asc(revisions.projectId),
      asc(revisions.targetType),
      asc(revisions.targetId),
    )
    .all();

  const perTarget: RevisionTargetUsage[] = perTargetRows.map((row) => ({
    projectId: row.projectId,
    targetType: row.targetType,
    targetId: row.targetId,
    revisionCount: row.revisionCount,
    snapshotBytes: row.snapshotBytes,
  }));

  const pageCountResult = await db.$client.execute('PRAGMA page_count');
  const pageSizeResult = await db.$client.execute('PRAGMA page_size');
  const pageCount = asFiniteNumber(
    pageCountResult.rows[0]?.page_count ?? pageCountResult.rows[0]?.[0],
  );
  const pageSize = asFiniteNumber(pageSizeResult.rows[0]?.page_size ?? pageSizeResult.rows[0]?.[0]);
  const databaseBytes = pageCount * pageSize;
  const snapshotShareOfDatabase = databaseBytes === 0 ? 0 : snapshotBytes / databaseBytes;

  return {
    revisionCount,
    snapshotBytes,
    databaseBytes,
    snapshotShareOfDatabase,
    perTarget,
  };
}
