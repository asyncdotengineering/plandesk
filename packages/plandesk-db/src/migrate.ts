import type { Db } from './client.js';
import { MIGRATIONS } from './migrations.generated.js';
import { listAppliedMigrationCreatedAts } from './schema-drift.js';

// Byte-identical to drizzle's file migrator, which created this table on every
// database migrated before the bundle; sqlite_master keeps the text verbatim.
const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
\t\t\tid SERIAL PRIMARY KEY,
\t\t\thash text NOT NULL,
\t\t\tcreated_at numeric
\t\t)`;

/**
 * Apply every bundled migration whose journal `when` is not yet recorded in
 * `__drizzle_migrations`, in order, one transaction per migration.
 *
 * `client.migrate` runs `PRAGMA foreign_keys=off` → BEGIN → statements → COMMIT
 * → `PRAGMA foreign_keys=on` on one connection (local) or one Hrana stream
 * (remote), so table rebuilds that drop FK-referenced tables work on sqld and
 * Turso too, where a PRAGMA sent in a separate call never reaches the batch.
 * SQLite can't toggle `foreign_keys` inside a transaction, so verify with
 * foreign_key_check afterwards.
 */
export async function migrate(db: Db): Promise<{ applied: string[] }> {
  await db.$client.execute(CREATE_MIGRATIONS_TABLE);
  const done = new Set(await listAppliedMigrationCreatedAts(db));
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.when)) {
      continue;
    }
    await db.$client.migrate([
      ...migration.statements,
      {
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [migration.hash, migration.when],
      },
    ]);
    applied.push(migration.tag);
  }
  const violations = (await db.$client.execute('PRAGMA foreign_key_check')).rows;
  if (violations.length > 0) {
    throw new Error(
      `Migration left ${String(violations.length)} foreign key violation(s): ${JSON.stringify(violations)}`,
    );
  }
  return { applied };
}
