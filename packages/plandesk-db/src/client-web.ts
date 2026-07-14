/**
 * Edge/libSQL web client entry — pins `@libsql/client/web` so Workers never
 * bundle the Node native build of `@libsql/client`.
 *
 * Do not re-export this from the package root; import via `@plandesk/db/web`.
 */
import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql';
import type { Db } from './client.js';
import * as schema from './schema.js';

/**
 * Create a Drizzle db against a remote libSQL/Turso URL using the web client.
 * Never migrates — edge runtimes have no migration filesystem (REQ-23).
 */
export async function createWebDb(url: string, authToken?: string): Promise<Db> {
  const client = createClient(
    authToken !== undefined && authToken.length > 0
      ? { url, authToken }
      : { url },
  );
  await client.execute('PRAGMA foreign_keys = ON');
  return drizzle(client, { schema });
}
