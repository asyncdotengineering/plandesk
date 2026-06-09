import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.js';

export type SyncDb = BaseSQLiteDatabase<'async', unknown, typeof schema>;
export type SyncDbClient = SyncDb;

function toLibsqlUrl(pathOrUrl: string): string {
  if (
    pathOrUrl === ':memory:' ||
    pathOrUrl.startsWith('file:') ||
    pathOrUrl.startsWith('libsql:') ||
    pathOrUrl.startsWith('http://') ||
    pathOrUrl.startsWith('https://')
  ) {
    return pathOrUrl;
  }
  return `file:${pathOrUrl}`;
}

export function createSyncDb(pathOrUrl: string): SyncDb {
  const client = createClient({ url: toLibsqlUrl(pathOrUrl) });
  return drizzle({ client, schema });
}
