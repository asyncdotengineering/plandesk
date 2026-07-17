import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

// Table-rebuild migrations (add a NOT NULL column to a referenced table via
// the create-copy-drop-rename dance) must run with foreign_keys OFF: DROP TABLE
// does an implicit row-delete that trips deferred FK counters even when the
// final state is consistent. `foreign_keys` cannot be toggled inside a
// transaction, and drizzle's migrator wraps each migration in one — so we must
// disable it at the connection level around the whole migrate call, then
// re-verify integrity with foreign_key_check.
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
