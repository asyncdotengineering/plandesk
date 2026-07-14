import { eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { syncRemotes } from '../schema.js';

export type SyncRemote = typeof syncRemotes.$inferSelect;

export type SetSyncRemoteInput = {
  serverUrl: string;
  globalProjectId: string;
  syncToken: string;
};

export async function setSyncRemote(
  db: DbClient,
  projectId: string,
  input: SetSyncRemoteInput,
): Promise<SyncRemote> {
  const now = new Date();
  const existing = await db
    .select({ projectId: syncRemotes.projectId })
    .from(syncRemotes)
    .where(eq(syncRemotes.projectId, projectId))
    .get();

  if (existing !== undefined) {
    const rows = await db
      .update(syncRemotes)
      .set({
        serverUrl: input.serverUrl,
        globalProjectId: input.globalProjectId,
        syncToken: input.syncToken,
        updatedAt: now,
      })
      .where(eq(syncRemotes.projectId, projectId))
      .returning()
      .all();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Failed to update sync remote');
    }
    return row;
  }

  const rows = await db
    .insert(syncRemotes)
    .values({
      projectId,
      serverUrl: input.serverUrl,
      globalProjectId: input.globalProjectId,
      syncToken: input.syncToken,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .all();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Failed to set sync remote');
  }
  return row;
}

export async function getSyncRemote(
  db: DbClient,
  projectId: string,
): Promise<SyncRemote | undefined> {
  return db.select().from(syncRemotes).where(eq(syncRemotes.projectId, projectId)).get();
}

export async function deleteSyncRemoteByProjectId(
  db: DbClient,
  projectId: string,
): Promise<number> {
  const result = await db.delete(syncRemotes).where(eq(syncRemotes.projectId, projectId)).run();
  return result.rowsAffected;
}
