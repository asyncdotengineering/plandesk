import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type SyncDb = ReturnType<typeof createSyncDb>;
export type SyncDbTx = Parameters<Parameters<SyncDb['transaction']>[0]>[0];
export type SyncDbClient = SyncDb | SyncDbTx;

export function createSyncDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}
