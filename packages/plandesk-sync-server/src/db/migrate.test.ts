import { describe, expect, it } from 'vitest';
import { createSyncDb } from './client.js';
import { migrate } from './migrate.js';

const EXPECTED_TABLES = [
  'activity_log',
  'hosted_shares',
  'participants',
  'projection_blobs',
  'sync_tokens',
] as const;

function listTables(db: ReturnType<typeof createSyncDb>): string[] {
  const rows = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe('migrate', () => {
  it('creates all hosted tables on a fresh database', () => {
    const db = createSyncDb(':memory:');
    migrate(db);
    const tables = listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('is idempotent when run twice', () => {
    const db = createSyncDb(':memory:');
    migrate(db);
    const afterFirst = listTables(db);
    expect(() => {
      migrate(db);
    }).not.toThrow();
    expect(listTables(db)).toEqual(afterFirst);
  });

  it('adds mode and invited_emails columns to hosted_shares', () => {
    const db = createSyncDb(':memory:');
    db.$client.exec(`
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
    `);
    migrate(db);

    const columns = db.$client.prepare('PRAGMA table_info(hosted_shares)').all() as Array<{
      name: string;
    }>;
    const names = columns.map((column) => column.name);
    expect(names).toContain('mode');
    expect(names).toContain('invited_emails');
  });
});
