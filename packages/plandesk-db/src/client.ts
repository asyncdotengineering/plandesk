import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { retryOnSqliteBusy } from './sqlite-errors.js';

/** Re-exported so callers can type the raw driver behind `db.$client` without their own `@libsql/client` dependency. */
export type { Client };

export type Db = Awaited<ReturnType<typeof createDb>>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbClient = Db | DbTx;

/** Throw from inside `withTransaction` to roll back and return `result` without committing. */
export class TransactionRollback<T = undefined> extends Error {
  readonly result: T;

  constructor(result: T) {
    super('transaction rollback');
    this.name = 'TransactionRollback';
    this.result = result;
  }
}

function normalizeUrl(path: string): string {
  if (path === ':memory:') {
    return ':memory:';
  }
  if (
    path.startsWith('file:') ||
    path.startsWith('libsql:') ||
    path.startsWith('http:') ||
    path.startsWith('https:') ||
    path.startsWith('ws:') ||
    path.startsWith('wss:')
  ) {
    return path;
  }
  return `file:${path}`;
}

/**
 * Open a libSQL/SQLite database.
 * @param path file path, `:memory:`, or remote `libsql:`/`https:` URL
 * @param authToken optional Turso/libSQL auth token (remote only; never used for local files)
 */
export async function createDb(path: string, authToken?: string) {
  const url = normalizeUrl(path);
  const client = createClient(
    authToken !== undefined && authToken.length > 0 ? { url, authToken } : { url },
  );
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA busy_timeout = 250');
  if (url !== ':memory:') {
    await client.execute('PRAGMA journal_mode = WAL');
  }
  return drizzle(client, { schema });
}

/**
 * Run `fn` inside a same-connection SQL transaction.
 *
 * Prefer this over `db.transaction()` for work that must stay on one
 * connection. libsql's interactive `client.transaction()` nulls the client
 * handle and opens a new connection for later work — with a bare `:memory:`
 * URL that new connection is a different empty database, so the schema and
 * data from the first connection vanish.
 */
export async function withTransaction<T>(db: Db, fn: (db: Db) => Promise<T>): Promise<T> {
  await db.$client.execute('BEGIN');
  try {
    const result = await fn(db);
    await retryOnSqliteBusy(() => db.$client.execute('COMMIT'));
    return result;
  } catch (error) {
    try {
      await db.$client.execute('ROLLBACK');
    } catch {
      // Ignore rollback failures (connection may already be closed/aborted).
    }
    if (error instanceof TransactionRollback) {
      return error.result as T;
    }
    throw error;
  }
}
