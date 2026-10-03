import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, TransactionRollback, withTransaction, type Db } from './client.js';
import { findSqld, startSqld } from './testing/sqld.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function fileUrl(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-tx-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return Promise.resolve(join(dir, 'board.db'));
}

const sqld = findSqld();
const backends: [string, () => Promise<string>][] = [
  [':memory: database', () => Promise.resolve(':memory:')],
  ['file database', fileUrl],
];
if (sqld !== undefined) {
  backends.push([
    'sqld over HTTP',
    async () => {
      const server = await startSqld(sqld);
      cleanups.push(server.stop);
      return server.url;
    },
  ]);
}

async function open(makeUrl: () => Promise<string>): Promise<Db> {
  const db = await createDb(await makeUrl());
  await db.run(sql`CREATE TABLE t (n INTEGER PRIMARY KEY)`);
  return db;
}

async function rows(db: Db): Promise<number[]> {
  return (await db.all<{ n: number }>(sql`SELECT n FROM t ORDER BY n`)).map((r) => r.n);
}

describe.each(backends)('withTransaction on a %s', (_name, makeUrl) => {
  it('commits the work and returns its result', async () => {
    const db = await open(makeUrl);
    const result = await withTransaction(db, async (tx) => {
      await tx.run(sql`INSERT INTO t (n) VALUES (1)`);
      return 'done';
    });
    expect(result).toBe('done');
    expect(await rows(db)).toEqual([1]);
  });

  it('writes nothing when the work throws', async () => {
    const db = await open(makeUrl);
    await db.run(sql`INSERT INTO t (n) VALUES (1)`);
    await expect(
      withTransaction(db, async (tx) => {
        await tx.run(sql`INSERT INTO t (n) VALUES (2)`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await rows(db)).toEqual([1]);
  });

  it('returns the TransactionRollback result and writes nothing', async () => {
    const db = await open(makeUrl);
    const result = await withTransaction(db, async (tx) => {
      await tx.run(sql`INSERT INTO t (n) VALUES (3)`);
      throw new TransactionRollback('kept');
    });
    expect(result).toBe('kept');
    expect(await rows(db)).toEqual([]);
  });

  it('reads its own uncommitted writes', async () => {
    const db = await open(makeUrl);
    const seen = await withTransaction(db, async (tx) => {
      await tx.run(sql`INSERT INTO t (n) VALUES (4)`);
      return rows(tx);
    });
    expect(seen).toEqual([4]);
  });
});

describe.skipIf(sqld === undefined)('withTransaction against sqld over HTTP', () => {
  // Read-then-write in each: without isolation both read 0 and the second
  // insert of 1 collides on the primary key.
  it('serialises two concurrent transactions', async () => {
    const server = await startSqld(sqld ?? '');
    cleanups.push(server.stop);
    const db = await open(() => Promise.resolve(server.url));
    const readThenInsert = async (tx: Db) => {
      const max = (await rows(tx)).at(-1) ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 50));
      await tx.run(sql`INSERT INTO t (n) VALUES (${max + 1})`);
    };
    await Promise.all([withTransaction(db, readThenInsert), withTransaction(db, readThenInsert)]);
    expect(await rows(db)).toEqual([1, 2]);
  });
});
