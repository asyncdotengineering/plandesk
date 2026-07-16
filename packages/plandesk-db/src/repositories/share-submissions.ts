import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { shareSubmissions, syncState, type ShareSubmissionStatus } from '../schema.js';

export type ShareSubmission = typeof shareSubmissions.$inferSelect;
export type { ShareSubmissionStatus };

export type UpsertSubmissionInput = {
  id: string;
  projectId: string;
  hostedShareId: string;
  participantName: string;
  title: string;
  body?: string | null;
  severity?: string | null;
  taskRef?: string | null;
  status?: ShareSubmissionStatus;
  createdAt: Date;
  pulledAt: Date;
};

export type CreateGuestSubmissionInput = {
  projectId: string;
  hostedShareId: string;
  participantName: string;
  title: string;
  body?: string | null;
  severity?: string | null;
  taskRef?: string | null;
};

export async function upsertSubmission(db: DbClient, input: UpsertSubmissionInput): Promise<boolean> {
  const result = await db
    .insert(shareSubmissions)
    .values({
      id: input.id,
      projectId: input.projectId,
      hostedShareId: input.hostedShareId,
      participantName: input.participantName,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? null,
      taskRef: input.taskRef ?? null,
      status: input.status ?? 'pending',
      createdAt: input.createdAt,
      pulledAt: input.pulledAt,
    })
    .onConflictDoNothing()
    .run();

  return result.rowsAffected > 0;
}

/** Guest portal submit: insert a moderated pending row (same DB as owner triage). */
export async function createGuestSubmission(
  db: DbClient,
  input: CreateGuestSubmissionInput,
): Promise<ShareSubmission> {
  const id = randomUUID();
  const now = new Date();
  const rows = await db
    .insert(shareSubmissions)
    .values({
      id,
      projectId: input.projectId,
      hostedShareId: input.hostedShareId,
      participantName: input.participantName,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? null,
      taskRef: input.taskRef ?? null,
      status: 'pending',
      createdAt: now,
      pulledAt: now,
    })
    .returning()
    .all();

  const row = rows[0];
  if (row === undefined) {
    throw new Error('Failed to create guest submission');
  }
  return row;
}

export async function countRecentSubmissionsByParticipant(
  db: DbClient,
  input: { hostedShareId: string; participantName: string; since: Date },
): Promise<number> {
  const row = await db
    .select({ count: count() })
    .from(shareSubmissions)
    .where(
      and(
        eq(shareSubmissions.hostedShareId, input.hostedShareId),
        eq(shareSubmissions.participantName, input.participantName),
        gt(shareSubmissions.createdAt, input.since),
      ),
    )
    .get();
  return row?.count ?? 0;
}

export async function listSubmissionsByShareAndParticipant(
  db: DbClient,
  input: { hostedShareId: string; participantName: string },
): Promise<ShareSubmission[]> {
  return db
    .select()
    .from(shareSubmissions)
    .where(
      and(
        eq(shareSubmissions.hostedShareId, input.hostedShareId),
        eq(shareSubmissions.participantName, input.participantName),
      ),
    )
    .orderBy(desc(shareSubmissions.createdAt))
    .all();
}

export async function listSubmissions(
  db: DbClient,
  projectId: string,
  status?: ShareSubmissionStatus,
): Promise<ShareSubmission[]> {
  const conditions = status
    ? and(eq(shareSubmissions.projectId, projectId), eq(shareSubmissions.status, status))
    : eq(shareSubmissions.projectId, projectId);

  return db
    .select()
    .from(shareSubmissions)
    .where(conditions)
    .orderBy(asc(shareSubmissions.createdAt))
    .all();
}

export async function getSubmission(
  db: DbClient,
  id: string,
): Promise<ShareSubmission | undefined> {
  return db.select().from(shareSubmissions).where(eq(shareSubmissions.id, id)).get();
}

export async function setSubmissionStatus(
  db: DbClient,
  id: string,
  input: { status: ShareSubmissionStatus; linkedTaskId?: string | null },
): Promise<ShareSubmission | undefined> {
  const rows = await db
    .update(shareSubmissions)
    .set({
      status: input.status,
      ...(input.linkedTaskId !== undefined ? { linkedTaskId: input.linkedTaskId } : {}),
    })
    .where(eq(shareSubmissions.id, id))
    .returning()
    .all();

  return rows[0];
}

export async function getPullCursor(db: DbClient, projectId: string): Promise<string | undefined> {
  const row = await db
    .select({ pullCursor: syncState.pullCursor })
    .from(syncState)
    .where(eq(syncState.projectId, projectId))
    .get();

  return row?.pullCursor ?? undefined;
}

export async function setPullCursor(
  db: DbClient,
  projectId: string,
  cursor: string,
): Promise<void> {
  const now = new Date();
  const existing = await db
    .select({ projectId: syncState.projectId })
    .from(syncState)
    .where(eq(syncState.projectId, projectId))
    .get();

  if (existing !== undefined) {
    await db
      .update(syncState)
      .set({ pullCursor: cursor, updatedAt: now })
      .where(eq(syncState.projectId, projectId))
      .run();
    return;
  }

  await db
    .insert(syncState)
    .values({
      projectId,
      pullCursor: cursor,
      updatedAt: now,
    })
    .run();
}

export async function deleteShareSubmissionsByProjectId(
  db: DbClient,
  projectId: string,
): Promise<number> {
  const result = await db
    .delete(shareSubmissions)
    .where(eq(shareSubmissions.projectId, projectId))
    .run();
  return result.rowsAffected;
}

export async function deleteSyncStateByProjectId(db: DbClient, projectId: string): Promise<number> {
  const result = await db.delete(syncState).where(eq(syncState.projectId, projectId)).run();
  return result.rowsAffected;
}
