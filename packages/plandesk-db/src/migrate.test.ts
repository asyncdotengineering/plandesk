import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { seed, FIXTURE_PROJECT_ID } from './seed.js';
import { getProject } from './repositories/projects.js';

const EXPECTED_TABLES = [
  'projects',
  'goals',
  'tasks',
  'edges',
  'documents',
  'folders',
  'notes',
  'tags',
  'task_tags',
  'comments',
  'agent_runs',
  'agent_run_events',
  'shares',
  'guest_sessions',
  'share_submissions',
  'sync_state',
  'sync_remotes',
  'files',
  'artifacts',
  '__drizzle_migrations',
] as const;

const LEGACY_TABLES = [
  'orgs',
  'org_members',
  'sessions',
  'pending_auth',
  'mcp_tokens',
] as const;

async function listTables(db: Awaited<ReturnType<typeof createDb>>): Promise<string[]> {
  const result = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

async function hasColumn(
  db: Awaited<ReturnType<typeof createDb>>,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await db.$client.execute(`PRAGMA table_info(${table})`);
  return result.rows.some((row) => row.name === column);
}

describe('migrate', () => {
  it('creates the final domain schema on a fresh database (no legacy org tables)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
    for (const table of LEGACY_TABLES) {
      expect(tables).not.toContain(table);
    }
    expect(await hasColumn(db, 'projects', 'org_id')).toBe(true);
    expect(await hasColumn(db, 'projects', 'canvas_layout')).toBe(true);
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(true);
    expect(await hasColumn(db, 'goals', 'last_verification')).toBe(true);
    expect(await hasColumn(db, 'comments', 'anchor')).toBe(true);
    expect(await hasColumn(db, 'documents', 'folder_id')).toBe(true);
  });

  it('is idempotent when run twice', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const afterFirst = await listTables(db);
    await expect(migrate(db)).resolves.not.toThrow();
    expect(await listTables(db)).toEqual(afterFirst);
  });

  it('seed works on a fresh migrated database', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await seed(db);
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.name).toBe('Fixture Project');
  });
});
