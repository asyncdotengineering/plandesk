import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleFileMigrate } from 'drizzle-orm/libsql/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate } from './migrate.js';
import { getSchemaMigrationSummary } from './schema-drift.js';

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
});

function findSqld(): string | undefined {
  const onPath = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'sqld'));
  return [...onPath, join(homedir(), '.turso', 'sqld')].find((bin) => existsSync(bin));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('no port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

const sqld = findSqld();
const running: { proc: ChildProcess; dir: string }[] = [];

// A throwaway sqld per test: libSQL over HTTP (Hrana) runs each request on its
// own stream, so connection-level PRAGMAs don't carry between calls.
async function startSqld(binary: string): Promise<string> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-sqld-'));
  const proc = spawn(binary, ['--http-listen-addr', `127.0.0.1:${String(port)}`, '-d', dir], {
    stdio: 'ignore',
  });
  running.push({ proc, dir });
  const url = `http://127.0.0.1:${String(port)}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${url}/health`)).ok) {
        return url;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`sqld did not come up on ${url}`);
}

afterEach(() => {
  for (const { proc, dir } of running.splice(0)) {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(sqld === undefined)('bundled migrate against sqld over HTTP', () => {
  const binary = sqld ?? '';

  it('opens a remote database and applies the full chain', async () => {
    const db = await createDb(await startSqld(binary));
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
    const db = await createDb(await startSqld(binary));
    const preamble = journal.entries.slice(0, 2);
    await db.$client.execute(
      'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    for (const entry of preamble) {
      const sql = readFileSync(join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      await db.$client.batch(
        [
          ...sql.split('--> statement-breakpoint'),
          {
            sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
            args: [createHash('sha256').update(sql).digest('hex'), entry.when],
          },
        ],
        'write',
      );
    }
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
});
