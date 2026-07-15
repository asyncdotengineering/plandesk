import { eq } from 'drizzle-orm';
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
