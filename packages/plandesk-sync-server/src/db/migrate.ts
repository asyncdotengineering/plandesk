import { sql } from 'drizzle-orm';
import type { SyncDb } from './client.js';

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sync_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  revoked_at INTEGER
)`,
  `CREATE TABLE IF NOT EXISTS hosted_shares (
  id TEXT PRIMARY KEY NOT NULL,
  project_global_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  audience_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'invite',
  invited_emails TEXT,
  permissions TEXT NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS hosted_shares_token_hash_unique ON hosted_shares (token_hash)`,
  `CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  name TEXT NOT NULL,
  email TEXT,
  session_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  revoked_at INTEGER
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS participants_session_token_hash_unique ON participants (session_token_hash)`,
  `CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  participant_id TEXT REFERENCES participants(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
)`,
  `CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL REFERENCES hosted_shares(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT,
  task_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
)`,
] as const;

type TableInfoRow = { name: string };

async function columnExists(db: SyncDb, table: string, column: string): Promise<boolean> {
  const rows = await db.all<TableInfoRow>(sql.raw(`PRAGMA table_info(${table})`));
  return rows.some((row) => row.name === column);
}

async function migrateHostedSharesColumns(db: SyncDb): Promise<void> {
  if (!(await columnExists(db, 'hosted_shares', 'mode'))) {
    await db.run(
      sql.raw("ALTER TABLE hosted_shares ADD COLUMN mode TEXT NOT NULL DEFAULT 'invite'"),
    );
  }
  if (!(await columnExists(db, 'hosted_shares', 'invited_emails'))) {
    await db.run(sql.raw('ALTER TABLE hosted_shares ADD COLUMN invited_emails TEXT'));
  }
}

export async function migrate(db: SyncDb): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys = ON`);
  for (const statement of MIGRATION_STATEMENTS) {
    await db.run(sql.raw(statement));
  }
  await migrateHostedSharesColumns(db);
}
