import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSyncDb, type SyncDb } from './client.js';
import { migrate } from './migrate.js';

const EXPECTED_TABLES = [
  'activity_log',
  'hosted_shares',
  'participants',
  'projection_blobs',
  'submissions',
  'sync_tokens',
] as const;

async function listTables(db: SyncDb): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  return rows.map((row) => row.name);
}

describe('migrate', () => {
  it('creates all hosted tables on a fresh database', async () => {
    const db = createSyncDb(':memory:');
    await migrate(db);
    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('is idempotent when run twice', async () => {
    const db = createSyncDb(':memory:');
    await migrate(db);
    const afterFirst = await listTables(db);
    await expect(migrate(db)).resolves.toBeUndefined();
    expect(await listTables(db)).toEqual(afterFirst);
  });

  it('adds mode and invited_emails columns to hosted_shares', async () => {
    const db = createSyncDb(':memory:');
    await db.run(
      sql.raw(`
      CREATE TABLE hosted_shares (
        id TEXT PRIMARY KEY NOT NULL,
        project_global_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        audience_name TEXT NOT NULL,
        permissions TEXT NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `),
    );
    await migrate(db);

    const columns = await db.all<{ name: string }>(sql.raw('PRAGMA table_info(hosted_shares)'));
    const names = columns.map((column) => column.name);
    expect(names).toContain('mode');
    expect(names).toContain('invited_emails');
  });
});
