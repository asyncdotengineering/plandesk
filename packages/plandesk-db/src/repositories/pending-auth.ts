import { eq, lt } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { pendingAuth } from '../schema.js';

export type PendingAuth = typeof pendingAuth.$inferSelect;

export async function createPendingAuth(
  db: DbClient,
  input: { authId: string; deviceCode: string; expiresAt: Date },
): Promise<PendingAuth> {
  const rows = await db.insert(pendingAuth).values({
    authId: input.authId,
    deviceCode: input.deviceCode,
    expiresAt: input.expiresAt,
    createdAt: new Date(),
  }).returning().all();
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to create pending auth');
  return row;
}

export async function getPendingAuth(db: DbClient, authId: string): Promise<PendingAuth | undefined> {
  return db.select().from(pendingAuth).where(eq(pendingAuth.authId, authId)).get();
}

export async function deletePendingAuth(db: DbClient, authId: string): Promise<void> {
  await db.delete(pendingAuth).where(eq(pendingAuth.authId, authId)).run();
}

/**
 * Drop every expired row. The poll path only ever deletes the `auth_id` it was
 * handed, so an abandoned login (start, then Ctrl-C, never poll again) would
 * otherwise leave a row nothing reaches. `/auth/device/start` is necessarily
 * unauthenticated, so that leak is anonymous and unbounded.
 *
 * Sweeping on start keeps it self-limiting: the only way to add rows is the same
 * call that clears the dead ones, and it needs no scheduler or cross-instance
 * state (which the serverless design has none of).
 */
export async function deleteExpiredPendingAuth(db: DbClient, now: Date = new Date()): Promise<void> {
  await db.delete(pendingAuth).where(lt(pendingAuth.expiresAt, now)).run();
}
