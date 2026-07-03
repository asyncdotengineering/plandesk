import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

type MigrationJournal = {
  entries: Array<{ idx: number; tag: string }>;
};

const DOWN_SQL: Record<string, string[]> = {
  '0006_thin_lila_cheney': [
    'ALTER TABLE `documents` DROP COLUMN `folder_id`;',
    'DROP TABLE IF EXISTS `folders`;',
  ],
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

function appliedMigrationCount(db: Db): number {
  const row = db.$client.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count;
}

export function migrate(db: Db): void {
  drizzleMigrate(db, { migrationsFolder });
}

export function migrateDown(db: Db, steps = 1): void {
  if (steps <= 0) {
    return;
  }

  const applied = appliedMigrationCount(db);
  if (applied === 0) {
    return;
  }

  const journal = loadJournal();
  const revertCount = Math.min(steps, applied);
  const tags = journal.entries
    .slice(applied - revertCount, applied)
    .map((entry) => entry.tag)
    .reverse();

  for (const tag of tags) {
    const statements = DOWN_SQL[tag];
    if (statements === undefined) {
      throw new Error(`no down migration defined for ${tag}`);
    }
    for (const sql of statements) {
      db.$client.exec(sql);
    }
    db.$client
      .prepare(
        'DELETE FROM __drizzle_migrations WHERE rowid = (SELECT MAX(rowid) FROM __drizzle_migrations)',
      )
      .run();
  }
}

export function migrateDownAll(db: Db): void {
  migrateDown(db, appliedMigrationCount(db));
}
