import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

type MigrationJournal = {
  entries: Array<{ idx: number; tag: string }>;
};

const DOWN_SQL: Record<string, string[]> = {
  '0014_sloppy_photon': [
    // Reverse composite files PK → single-column id PK
    `CREATE TABLE \`__old_files\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`project_id\` text NOT NULL,
	\`filename\` text NOT NULL,
	\`mime\` text NOT NULL,
	\`size\` integer NOT NULL,
	\`bytes\` blob,
	\`external_url\` text,
	\`created_at\` text NOT NULL,
	FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE no action
);`,
    'INSERT INTO `__old_files` (`id`, `project_id`, `filename`, `mime`, `size`, `bytes`, `external_url`, `created_at`) SELECT `id`, `project_id`, `filename`, `mime`, `size`, `bytes`, `external_url`, `created_at` FROM `files`;',
    'DROP TABLE `files`;',
    'ALTER TABLE `__old_files` RENAME TO `files`;',
    // Drop org_id/scope from mcp_tokens
    `CREATE TABLE \`__old_mcp_tokens\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`token_hash\` text NOT NULL,
	\`created_at\` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	\`revoked_at\` integer
);`,
    'INSERT INTO `__old_mcp_tokens` (`id`, `name`, `token_hash`, `created_at`, `revoked_at`) SELECT `id`, `name`, `token_hash`, `created_at`, `revoked_at` FROM `mcp_tokens`;',
    'DROP TABLE `mcp_tokens`;',
    'ALTER TABLE `__old_mcp_tokens` RENAME TO `mcp_tokens`;',
    // Drop org_id from projects
    `CREATE TABLE \`__old_projects\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`description\` text,
	\`canvas_layout\` text,
	\`created_at\` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);`,
    'INSERT INTO `__old_projects` (`id`, `name`, `description`, `canvas_layout`, `created_at`, `updated_at`) SELECT `id`, `name`, `description`, `canvas_layout`, `created_at`, `updated_at` FROM `projects`;',
    'DROP TABLE `projects`;',
    'ALTER TABLE `__old_projects` RENAME TO `projects`;',
    'DROP TABLE IF EXISTS `org_members`;',
    'DROP TABLE IF EXISTS `orgs`;',
  ],
  '0013_curious_hedge_knight': ['DROP TABLE IF EXISTS `artifacts`;'],
  '0012_needy_nico_minoru': ['DROP TABLE IF EXISTS `files`;'],
  '0011_lush_bushwacker': ['ALTER TABLE `comments` DROP COLUMN `anchor`;'],
  '0010_polymorphic_comments': [
    `CREATE TABLE \`document_comments\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`document_id\` text NOT NULL,
	\`passage\` text,
	\`body\` text NOT NULL,
	\`resolved\` integer DEFAULT false NOT NULL,
	\`created_at\` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (\`document_id\`) REFERENCES \`documents\`(\`id\`) ON UPDATE no action ON DELETE no action
);`,
    `INSERT INTO \`document_comments\` (\`id\`, \`document_id\`, \`passage\`, \`body\`, \`resolved\`, \`created_at\`)
SELECT \`id\`, \`target_id\`, \`passage\`, \`body\`, \`resolved\`, \`created_at\`
FROM \`comments\` WHERE \`target_type\` = 'document';`,
    'DROP TABLE `comments`;',
  ],
  '0009_watery_santa_claus': ['ALTER TABLE `goals` DROP COLUMN `last_verification`;'],
  '0008_damp_moonstone': [
    `CREATE TABLE \`__old_tasks\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`project_id\` text NOT NULL,
	\`label\` text NOT NULL,
	\`status\` text DEFAULT 'todo' NOT NULL,
	\`description\` text,
	\`x\` real DEFAULT 0 NOT NULL,
	\`y\` real DEFAULT 0 NOT NULL,
	\`assignee\` text,
	\`due_date\` integer,
	\`created_at\` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE no action
);`,
    'INSERT INTO `__old_tasks` (`id`, `project_id`, `label`, `status`, `description`, `x`, `y`, `assignee`, `due_date`, `created_at`, `updated_at`) SELECT `id`, `project_id`, `label`, `status`, `description`, `x`, `y`, `assignee`, `due_date`, `created_at`, `updated_at` FROM `tasks`;',
    'DROP TABLE `tasks`;',
    'ALTER TABLE `__old_tasks` RENAME TO `tasks`;',
    'DROP TABLE IF EXISTS `goals`;',
  ],
  '0006_thin_lila_cheney': [
    'ALTER TABLE `documents` DROP COLUMN `folder_id`;',
    'DROP TABLE IF EXISTS `folders`;',
  ],
  '0007_busy_naoko': ['DROP TABLE IF EXISTS `task_tags`;', 'DROP TABLE IF EXISTS `tags`;'],
  '0005_bouncy_selene': ['DROP TABLE IF EXISTS `notes`;'],
  '0004_striped_sumo': ['DROP TABLE IF EXISTS `sync_remotes`;'],
  '0003_real_fallen_one': [
    'DROP TABLE IF EXISTS `sync_state`;',
    'DROP TABLE IF EXISTS `share_submissions`;',
  ],
  '0002_outgoing_charles_xavier': ['DROP TABLE IF EXISTS `shares`;'],
  '0001_thankful_lizard': ['ALTER TABLE `projects` DROP COLUMN `canvas_layout`;'],
  '0000_gifted_stephen_strange': [
    'DROP TABLE IF EXISTS `agent_run_events`;',
    'DROP TABLE IF EXISTS `agent_runs`;',
    'DROP TABLE IF EXISTS `comments`;',
    'DROP TABLE IF EXISTS `document_comments`;',
    'DROP TABLE IF EXISTS `documents`;',
    'DROP TABLE IF EXISTS `edges`;',
    'DROP TABLE IF EXISTS `mcp_tokens`;',
    'DROP TABLE IF EXISTS `tasks`;',
    'DROP TABLE IF EXISTS `projects`;',
  ],
};

function loadJournal(): MigrationJournal {
  const journalPath = join(migrationsFolder, 'meta/_journal.json');
  return JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
}

async function appliedMigrationCount(db: Db): Promise<number> {
  const result = await db.$client.execute('SELECT COUNT(*) AS count FROM __drizzle_migrations');
  const row = result.rows[0];
  return Number(row?.count ?? 0);
}

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

export async function migrateDown(db: Db, steps = 1): Promise<void> {
  if (steps <= 0) {
    return;
  }

  const applied = await appliedMigrationCount(db);
  if (applied === 0) {
    return;
  }

  const journal = loadJournal();
  const revertCount = Math.min(steps, applied);
  const tags = journal.entries
    .slice(applied - revertCount, applied)
    .map((entry) => entry.tag)
    .reverse();

  await withForeignKeysDisabled(db, async () => {
    await runDownStatements(db, tags);
  });
}

async function runDownStatements(db: Db, tags: string[]): Promise<void> {
  for (const tag of tags) {
    const statements = DOWN_SQL[tag];
    if (statements === undefined) {
      throw new Error(`no down migration defined for ${tag}`);
    }
    for (const sql of statements) {
      await db.$client.execute(sql);
    }
    await db.$client.execute(
      'DELETE FROM __drizzle_migrations WHERE rowid = (SELECT MAX(rowid) FROM __drizzle_migrations)',
    );
  }
}

export async function migrateDownAll(db: Db): Promise<void> {
  await migrateDown(db, await appliedMigrationCount(db));
}
