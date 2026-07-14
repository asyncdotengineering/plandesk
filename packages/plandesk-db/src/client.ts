import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Db = Awaited<ReturnType<typeof createDb>>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbClient = Db | DbTx;

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

export async function createDb(path: string) {
  const client = createClient({ url: normalizeUrl(path) });
  await client.execute('PRAGMA foreign_keys = ON');
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
    await db.$client.execute('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.$client.execute('ROLLBACK');
    } catch {
      // Ignore rollback failures (connection may already be closed/aborted).
    }
    throw error;
  }
}
