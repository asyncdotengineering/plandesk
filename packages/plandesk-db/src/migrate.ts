import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

export function migrate(db: Db): void {
  drizzleMigrate(db, { migrationsFolder });
}
