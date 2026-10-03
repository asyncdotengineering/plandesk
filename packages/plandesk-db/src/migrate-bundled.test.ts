import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleFileMigrate } from 'drizzle-orm/libsql/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate } from './migrate.js';
import { getSchemaMigrationSummary } from './schema-drift.js';
import { findSqld, startSqld } from './testing/sqld.js';

const SEARCH_TRIGGERS = ['documents', 'notes', 'tasks']
  .flatMap((table) => ['ad', 'ai', 'au'].map((op) => `${table}_search_index_${op}`))
  .sort();

// The bundled migrator replaced drizzle's file migrator. Live boards were
// migrated by the old one, so its bookkeeping and resulting schema are the
// contract: the fixture is the old migrator's sqlite_master dump.

const drizzleDir = fileURLToPath(new URL('../drizzle/', import.meta.url));
const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string; when: number }[];
};
const journalTags = journal.entries.map((entry) => entry.tag);
const migratedSchema: unknown = JSON.parse(
  readFileSync(new URL('../test-fixtures/migrated-schema.json', import.meta.url), 'utf8'),
);

async function schemaDump(db: Db) {
  const result = await db.$client.execute(
    'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name',
  );
  return result.rows.map(({ type, name, tbl_name, sql }) => ({ type, name, tbl_name, sql }));
}

async function bookkeeping(db: Db) {
  const result = await db.$client.execute(
    'SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at',
  );
  return result.rows.map(({ id, hash, created_at }) => ({ id, hash, created_at }));
}

// What a board migrated by an older release looks like: the first `count`
// journal entries applied with the bookkeeping drizzle's file migrator wrote.
async function applyJournalPrefix(db: Db, count: number): Promise<void> {
  await db.$client.execute(
    'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  for (const entry of journal.entries.slice(0, count)) {
    const sql = readFileSync(join(drizzleDir, `${entry.tag}.sql`), 'utf8');
    await db.$client.migrate([
      ...sql.split('--> statement-breakpoint'),
      {
        sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
        args: [createHash('sha256').update(sql).digest('hex'), entry.when],
      },
    ]);
  }
}

// The sync subsystem's leftovers on a live board: a pull cursor and a pulled
// submission linked to a task.
const LAST_TAG_WITH_SYNC_STATE = '0024_sloppy_dark_phoenix';
const tagsAfterSyncState = journalTags.slice(journalTags.indexOf(LAST_TAG_WITH_SYNC_STATE) + 1);

async function seedSyncEraBoard(db: Db): Promise<void> {
  await applyJournalPrefix(db, journalTags.indexOf(LAST_TAG_WITH_SYNC_STATE) + 1);
  await db.$client.batch(
    [
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
      "INSERT INTO tasks (id, project_id, label) VALUES ('t1','p1','Fix it')",
      "INSERT INTO share_submissions (id, project_id, hosted_share_id, participant_name, title, status, linked_task_id, created_at, pulled_at) VALUES ('sub1','p1','hs1','Alex','Broken','accepted','t1',100,200)",
      "INSERT INTO sync_state (project_id, pull_cursor, updated_at) VALUES ('p1','2026-01-01T00:00:00.000Z',300)",
    ],
    'write',
  );
}

async function expectSyncStateRetired(db: Db): Promise<void> {
  expect(tagsAfterSyncState).not.toEqual([]);
  expect(await migrate(db)).toEqual({ applied: tagsAfterSyncState });
  expect((await db.$client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  const syncState = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE name = 'sync_state'",
  );
  expect(syncState.rows).toEqual([]);
  const submissions = await db.$client.execute(
    'SELECT id, project_id, linked_task_id, status, pulled_at FROM share_submissions',
  );
  expect(submissions.rows).toEqual([
    { id: 'sub1', project_id: 'p1', linked_task_id: 't1', status: 'accepted', pulled_at: 200 },
  ]);
  const triggers = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%search_index%' ORDER BY name",
  );
  expect(triggers.rows.map((row) => row.name)).toEqual(SEARCH_TRIGGERS);
  expect((await getSchemaMigrationSummary(db)).current).toBe(true);
}

async function migratedByDrizzleFileMigrator(): Promise<Db> {
  const db = await createDb(':memory:');
  await db.$client.execute('PRAGMA foreign_keys = OFF');
  await drizzleFileMigrate(db, { migrationsFolder: drizzleDir });
  await db.$client.execute('PRAGMA foreign_keys = ON');
  return db;
}

describe('bundled migrate on a local database', () => {
  it('builds the schema and bookkeeping the drizzle file migrator built', async () => {
    const db = await createDb(':memory:');
    expect(await migrate(db)).toEqual({ applied: journalTags });
    expect(await schemaDump(db)).toEqual(migratedSchema);
    expect(await bookkeeping(db)).toEqual(await bookkeeping(await migratedByDrizzleFileMigrator()));
  });

  it('sees a database the drizzle file migrator migrated as current and re-applies nothing', async () => {
    const db = await migratedByDrizzleFileMigrator();
    const before = await bookkeeping(db);
    expect(await migrate(db)).toEqual({ applied: [] });
    expect(await schemaDump(db)).toEqual(migratedSchema);
    expect(await bookkeeping(db)).toEqual(before);
    const summary = await getSchemaMigrationSummary(db);
    expect(summary.current).toBe(true);
    expect(summary.missingTags).toEqual([]);
  });

  it('retires sync_state on a populated sync-era board file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-sync-era-'));
    try {
      const db = await createDb(join(dir, 'board.db'));
      await seedSyncEraBoard(db);
      await expectSyncStateRetired(db);
      db.$client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const sqld = findSqld();
const stops: (() => void)[] = [];

// A throwaway sqld per test.
async function sqldUrl(binary: string): Promise<string> {
  const server = await startSqld(binary);
  stops.push(server.stop);
  return server.url;
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe.skipIf(sqld === undefined)('bundled migrate against sqld over HTTP', () => {
  const binary = sqld ?? '';

  it('opens a remote database and applies the full chain', async () => {
    const db = await createDb(await sqldUrl(binary));
    expect(await migrate(db)).toEqual({ applied: journalTags });

    const summary = await getSchemaMigrationSummary(db);
    expect(summary.current).toBe(true);
    expect((await db.$client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
    const local = migratedSchema as { type: string }[];
    const dump = await schemaDump(db);
    expect(dump.filter((row) => row.type === 'trigger')).toHaveLength(
      local.filter((row) => row.type === 'trigger').length,
    );
    expect(dump).toEqual(migratedSchema);
    expect(await migrate(db)).toEqual({ applied: [] });
  });

  // 0002 drops and rebuilds `shares` while guest_sessions references it. sqld
  // streams start with foreign_keys=1, so the drop only succeeds when FK checks
  // are off inside the migration's own stream.
  it('keeps foreign keys off while a migration rebuilds a referenced table', async () => {
    const db = await createDb(await sqldUrl(binary));
    await applyJournalPrefix(db, 2);
    await db.$client.batch(
      [
        "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
        "INSERT INTO shares (id, project_id, audience_name, mode, token_hash, permissions, policy, created_at) VALUES ('s1','p1','A','invite','h','{}','{}',0)",
        "INSERT INTO guest_sessions (id, share_id, project_id, name, token_hash, created_at) VALUES ('gs1','s1','p1','Alex','gh',0)",
      ],
      'write',
    );

    expect(await migrate(db)).toEqual({ applied: journalTags.slice(2) });
    expect((await db.$client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
    expect((await db.$client.execute('SELECT id, project_id FROM shares')).rows).toEqual([
      { id: 's1', project_id: 'p1' },
    ]);
    expect((await db.$client.execute('SELECT id, share_id FROM guest_sessions')).rows).toEqual([
      { id: 'gs1', share_id: 's1' },
    ]);
  });

  it('retires sync_state on a populated sync-era board', async () => {
    const db = await createDb(await sqldUrl(binary));
    await seedSyncEraBoard(db);
    await expectSyncStateRetired(db);
  });
});
