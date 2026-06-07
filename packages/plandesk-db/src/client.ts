import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbClient = Db | DbTx;

export function createDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}
