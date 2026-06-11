import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate, migrateDown, migrateDownAll } from './migrate.js';
import { seed, FIXTURE_PROJECT_ID } from './seed.js';
import { getProject } from './repositories/projects.js';

const EXPECTED_TABLES = [
  'projects',
  'tasks',
  'edges',
  'documents',
  'notes',
  'document_comments',
  'agent_runs',
  'agent_run_events',
  'mcp_tokens',
  'shares',
  'share_submissions',
  'sync_state',
  'sync_remotes',
  '__drizzle_migrations',
] as const;

const APP_TABLES = EXPECTED_TABLES.filter((table) => table !== '__drizzle_migrations');

function listTables(db: ReturnType<typeof createDb>): string[] {
  const rows = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function hasColumn(db: ReturnType<typeof createDb>, table: string, column: string): boolean {
  const rows = db.$client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

describe('migrate', () => {
  it('creates all RFC §4.4 tables on a fresh database', () => {
    const db = createDb(':memory:');
    migrate(db);
    const tables = listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('is idempotent when run twice', () => {
    const db = createDb(':memory:');
    migrate(db);
    const afterFirst = listTables(db);
    expect(() => {
      migrate(db);
    }).not.toThrow();
    expect(listTables(db)).toEqual(afterFirst);
  });

  it('regression: migrate up/down on empty database', () => {
    const db = createDb(':memory:');
    migrate(db);
    expect(listTables(db)).toEqual(expect.arrayContaining([...APP_TABLES]));
    expect(hasColumn(db, 'projects', 'canvas_layout')).toBe(true);

    migrateDownAll(db);
    expect(listTables(db)).not.toContain('projects');
    expect(listTables(db)).not.toContain('tasks');

    migrate(db);
    expect(listTables(db)).toEqual(expect.arrayContaining([...APP_TABLES]));
    expect(hasColumn(db, 'projects', 'canvas_layout')).toBe(true);
  });

  it('regression: migrate up/down on seeded database', () => {
    const db = createDb(':memory:');
    migrate(db);
    seed(db);
    expect(getProject(db, FIXTURE_PROJECT_ID)?.name).toBe('Fixture Project');

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('notes');

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('sync_remotes');

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('share_submissions');
    expect(listTables(db)).not.toContain('sync_state');

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('shares');

    migrateDown(db, 1);
    expect(hasColumn(db, 'projects', 'canvas_layout')).toBe(false);

    migrate(db);
    expect(hasColumn(db, 'projects', 'canvas_layout')).toBe(true);
    expect(listTables(db)).toContain('shares');
    expect(listTables(db)).toContain('share_submissions');
    expect(listTables(db)).toContain('sync_state');
    expect(listTables(db)).toContain('sync_remotes');
    expect(listTables(db)).toContain('notes');
    expect(getProject(db, FIXTURE_PROJECT_ID)?.name).toBe('Fixture Project');

    migrateDownAll(db);
    expect(listTables(db)).not.toContain('projects');

    migrate(db);
    seed(db);
    expect(getProject(db, FIXTURE_PROJECT_ID)?.name).toBe('Fixture Project');
  });
});
