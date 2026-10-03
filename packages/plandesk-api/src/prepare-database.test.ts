import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createDb, migrate, MIGRATIONS, SchemaDriftError, type Db } from '@plandesk/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { prepareDatabase, SchemaLeaseHeldError } from './prepare-database.js';

const TAGS = MIGRATIONS.map((m) => m.tag);
const LEASE_DDL =
  'CREATE TABLE IF NOT EXISTS __plandesk_lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL)';

function authFor(db: Db): BetterAuthInstance {
  const auth = createBetterAuth({
    client: db.$client,
    secret: 'test-secret-not-a-real-one-0123456789abcdef',
    baseURL: 'http://127.0.0.1',
  });
  if (auth === undefined) throw new Error('no auth');
  return auth;
}

async function setLease(db: Db, holder: string, expiresAt: number): Promise<void> {
  await db.$client.execute(LEASE_DDL);
  await db.$client.execute({
    sql: 'INSERT OR REPLACE INTO __plandesk_lease (id, holder, expires_at) VALUES (1, ?, ?)',
    args: [holder, expiresAt],
  });
}

async function leaseRows(db: Db): Promise<unknown[]> {
  return (await db.$client.execute('SELECT holder FROM __plandesk_lease')).rows.map(
    (r) => r.holder,
  );
}

async function bookkeepingCount(db: Db): Promise<number> {
  const result = await db.$client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations');
  return Number(result.rows[0]?.n);
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

// CI sets PLANDESK_REQUIRE_SQLD=1 so a missing binary fails the run instead of
// silently skipping the remote-database coverage.
function findSqld(): string | undefined {
  const onPath = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'sqld'));
  const bin = [...onPath, join(homedir(), '.turso', 'sqld')].find((path) => existsSync(path));
  if (bin === undefined && process.env.PLANDESK_REQUIRE_SQLD === '1') {
    throw new Error('PLANDESK_REQUIRE_SQLD=1 but no sqld on PATH or at ~/.turso/sqld');
  }
  return bin;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolve(address.port);
      });
    });
  });
}

function fileUrl(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-prepare-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return Promise.resolve(join(dir, 'workspace.db'));
}

async function sqldUrl(): Promise<string> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-prepare-sqld-'));
  const proc: ChildProcess = spawn(
    sqld ?? '',
    ['--http-listen-addr', `127.0.0.1:${String(port)}`, '-d', dir],
    { stdio: 'ignore' },
  );
  cleanups.push(() => {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${String(port)}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`sqld did not come up on ${url}`);
}

const sqld = findSqld();
const backends: [string, () => Promise<string>][] = [['file database', fileUrl]];
if (sqld !== undefined) backends.push(['sqld over HTTP', sqldUrl]);

describe.each(backends)('prepareDatabase on a %s', (_name, makeUrl) => {
  it('applies each migration exactly once when two instances prepare concurrently', async () => {
    const url = await makeUrl();
    const a = await createDb(url);
    const b = await createDb(url);
    const [ra, rb] = await Promise.all([
      prepareDatabase(a, authFor(a), { holder: 'a' }),
      prepareDatabase(b, authFor(b), { holder: 'b' }),
    ]);
    expect([...ra.applied, ...rb.applied].sort()).toEqual([...TAGS].sort());
    expect(await bookkeepingCount(a)).toBe(MIGRATIONS.length);
    const tables = await a.$client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization','apikey','team')",
    );
    expect(tables.rows).toHaveLength(3);
    expect(await leaseRows(a)).toEqual([]);
  });

  it('takes over an expired lease', async () => {
    const db = await createDb(await makeUrl());
    await setLease(db, 'crashed', Date.now() - 1_000);
    const { applied } = await prepareDatabase(db, authFor(db), { waitMs: 1_000 });
    expect(applied).toEqual(TAGS);
    expect(await leaseRows(db)).toEqual([]);
  });

  it('gives up naming the holder while another holder keeps the lease', async () => {
    const db = await createDb(await makeUrl());
    const expiresAt = Date.now() + 60_000;
    await setLease(db, 'busy', expiresAt);
    const started = Date.now();
    const error = await prepareDatabase(db, authFor(db), { waitMs: 600 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaLeaseHeldError);
    expect(error).toBeInstanceOf(SchemaDriftError);
    expect((error as SchemaLeaseHeldError).holder).toBe('busy');
    expect((error as SchemaLeaseHeldError).expiresAt).toBe(expiresAt);
    expect((error as Error).message).toContain('busy');
    expect((error as Error).message).toContain(new Date(expiresAt).toISOString());
    expect((error as SchemaDriftError).summary.current).toBe(false);
    expect((error as SchemaDriftError).summary.missingTags).toEqual(TAGS);
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
    expect(await leaseRows(db)).toEqual(['busy']);
    expect(await bookkeepingCount(db).catch(() => 0)).toBe(0);
  });

  it('takes the fast path on a prepared database without touching the lease', async () => {
    const db = await createDb(await makeUrl());
    const auth = authFor(db);
    await prepareDatabase(db, auth);
    // An expired lease is up for grabs: any acquire would overwrite it.
    await setLease(db, 'sentinel', Date.now() - 1_000);
    expect(await prepareDatabase(db, auth)).toEqual({ applied: [] });
    expect(await leaseRows(db)).toEqual(['sentinel']);
  });

  it('re-runs better-auth migrations when its schema is behind but ours is current', async () => {
    const db = await createDb(await makeUrl());
    const auth = authFor(db);
    await prepareDatabase(db, auth);
    await db.$client.execute('DROP TABLE apikey');
    expect(await prepareDatabase(db, auth)).toEqual({ applied: [] });
    const tables = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='apikey'",
    );
    expect(tables.rows).toHaveLength(1);
  });

  it('runs the backfills a crashed holder skipped', async () => {
    const db = await createDb(await makeUrl());
    const auth = authFor(db);
    // The holder died after the schema work, before either backfill.
    await migrate(db);
    await runBetterAuthMigrations(auth);

    await db.$client.execute(
      "INSERT INTO organization (id, name, slug, createdAt) VALUES ('org-a', 'A', 'a', '2026-01-01T00:00:00.000Z')",
    );
    expect(await prepareDatabase(db, auth)).toEqual({ applied: [] });
    const teams = await db.$client.execute("SELECT id FROM team WHERE organizationId = 'org-a'");
    expect(teams.rows).toHaveLength(1);

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, name, workspace_id) VALUES ('p-a', 'org-a', 'P', 'deleted-team')",
    );
    expect(await prepareDatabase(db, auth)).toEqual({ applied: [] });
    const project = await db.$client.execute("SELECT workspace_id FROM projects WHERE id = 'p-a'");
    expect(project.rows[0]?.workspace_id).toBe(teams.rows[0]?.id);
  });

  it('releases the lease when a migration fails', async () => {
    const db = await createDb(await makeUrl());
    await db.$client.execute('CREATE TABLE projects (x)');
    await expect(prepareDatabase(db, authFor(db))).rejects.toThrow(/projects/);
    expect(await leaseRows(db)).toEqual([]);
  });

  it('releases the lease when a backfill fails', async () => {
    const db = await createDb(await makeUrl());
    const auth = authFor(db);
    await prepareDatabase(db, auth);
    // No such organization: the default team insert breaks its foreign key.
    await db.$client.execute(
      "INSERT INTO projects (id, org_id, name, workspace_id) VALUES ('p-x', 'no-such-org', 'P', 'gone')",
    );
    await expect(prepareDatabase(db, auth)).rejects.toThrow();
    expect(await leaseRows(db)).toEqual([]);
  });
});
