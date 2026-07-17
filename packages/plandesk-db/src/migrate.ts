import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

// Drizzle wraps each migration in a transaction; SQLite cannot toggle
// `foreign_keys` inside a transaction. Disable FK checks at the connection
// level around the whole migrate call, then re-verify with foreign_key_check.
// Defensive for any future migration that rebuilds tables or rewrites rows
// referenced by FKs.
async function withForeignKeysDisabled(db: Db, fn: () => void | Promise<void>): Promise<void> {
  await db.$client.execute('PRAGMA foreign_keys = OFF');
  try {
    await fn();
  } finally {
    await db.$client.execute('PRAGMA foreign_keys = ON');
  }
  const check = await db.$client.execute('PRAGMA foreign_key_check');
  const violations = check.rows;
  if (violations.length > 0) {
    throw new Error(
      `Migration left ${String(violations.length)} foreign key violation(s): ${JSON.stringify(violations)}`,
    );
  }
}

export async function migrate(db: Db): Promise<void> {
  await withForeignKeysDisabled(db, async () => {
    await drizzleMigrate(db, { migrationsFolder });
  });
}
