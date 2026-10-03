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
  // sqld and Turso reject these over HTTP (SQL_PARSE_ERROR); they only mean
  // something for a local file anyway.
  if (url === ':memory:' || url.startsWith('file:')) {
    await client.execute('PRAGMA busy_timeout = 250');
    if (url !== ':memory:') {
      await client.execute('PRAGMA journal_mode = WAL');
    }
  }
  return drizzle(client, { schema });
}

/**
 * Run `fn` atomically; `fn` gets a `Db` bound to the transaction.
 *
 * Remote URLs (http/ws) run each `execute` on its own stream, so a plain BEGIN
 * there holds nothing: they use libsql's interactive `client.transaction()`,
 * which keeps one stream for the whole unit. Local databases must not: on
 * them it hands the connection to the transaction and lazily opens a new one
 * for later work — with `:memory:` a different empty database, with a file one
 * missing the PRAGMAs `createDb` set. They run BEGIN/COMMIT on their one
 * connection instead.
 *
 * Inside `fn` on a remote database, `db.$client` is the libsql Transaction:
 * pass statements as `{ sql, args }` (the two-argument `execute(sql, args)`
 * drops its args there), and never nest `withTransaction` or call
 * `db.transaction()` — the Transaction has neither.
 */
export async function withTransaction<T>(db: Db, fn: (db: Db) => Promise<T>): Promise<T> {
  if (db.$client.protocol !== 'file') {
    const tx = await db.$client.transaction('write');
    try {
      // The transaction serves drizzle as its client: same execute/batch shape.
      const result = await fn(drizzle({ client: tx as unknown as Client, schema }));
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      if (error instanceof TransactionRollback) {
        return error.result as T;
      }
      throw error;
    }
  }
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
