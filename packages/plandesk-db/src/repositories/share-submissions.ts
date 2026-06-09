import { and, asc, eq } from 'drizzle-orm';
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

export function upsertSubmission(db: DbClient, input: UpsertSubmissionInput): boolean {
  const result = db
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

  return result.changes > 0;
}

export function listSubmissions(
  db: DbClient,
  projectId: string,
  status?: ShareSubmissionStatus,
): ShareSubmission[] {
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

export function getSubmission(db: DbClient, id: string): ShareSubmission | undefined {
  return db.select().from(shareSubmissions).where(eq(shareSubmissions.id, id)).get();
}

export function setSubmissionStatus(
  db: DbClient,
  id: string,
  input: { status: ShareSubmissionStatus; linkedTaskId?: string | null },
): ShareSubmission | undefined {
  const rows = db
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

export function getPullCursor(db: DbClient, projectId: string): string | undefined {
  const row = db
    .select({ pullCursor: syncState.pullCursor })
    .from(syncState)
    .where(eq(syncState.projectId, projectId))
    .get();

  return row?.pullCursor ?? undefined;
}

export function setPullCursor(db: DbClient, projectId: string, cursor: string): void {
  const now = new Date();
  const existing = db
    .select({ projectId: syncState.projectId })
    .from(syncState)
    .where(eq(syncState.projectId, projectId))
    .get();

  if (existing !== undefined) {
    db.update(syncState)
      .set({ pullCursor: cursor, updatedAt: now })
      .where(eq(syncState.projectId, projectId))
      .run();
    return;
  }

  db.insert(syncState)
    .values({
      projectId,
      pullCursor: cursor,
      updatedAt: now,
    })
    .run();
}

export function deleteShareSubmissionsByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(shareSubmissions).where(eq(shareSubmissions.projectId, projectId)).run();
  return result.changes;
}

export function deleteSyncStateByProjectId(db: DbClient, projectId: string): number {
  const result = db.delete(syncState).where(eq(syncState.projectId, projectId)).run();
  return result.changes;
}
