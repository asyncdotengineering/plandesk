import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { seed, FIXTURE_PROJECT_ID } from './seed.js';
import { getProject } from './repositories/projects.js';

const drizzleDir = new URL('../drizzle/', import.meta.url);

// A migration that rebuilds two FK-linked tables (shares ↔ guest_sessions) must
// keep foreign_keys OFF across BOTH rebuilds. An inline PRAGMA foreign_keys=ON
// between them re-enables FK before the referenced table (shares) is dropped,
// which SQLITE_CONSTRAINT_FOREIGNKEY-blocks the drop on any DB with portal data.
// This applies the migrations raw (bypassing the migrator's bookkeeping) to
// reproduce the populated-DB transition the empty-db migrate() test cannot.
async function applyMigrationSqlRaw(db: Awaited<ReturnType<typeof createDb>>, file: string): Promise<void> {
  const sql = readFileSync(new URL(file, drizzleDir), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    await db.$client.execute(stmt);
  }
}

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

  // Regression: 0002 rebuilds shares + guest_sessions (FK-linked). With existing
  // portal data, a mid-migration PRAGMA foreign_keys=ON blocked DROP TABLE shares.
  it('0002 migrates a populated database without FK violations or data loss', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const preamble = files.slice(0, -1); // everything before 0002
    const last = files[files.length - 1]!;

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }
    // Realistic pre-0002 data: a project, a project-scoped share, and a guest
    // session that references the share (the FK that blocked the shares drop).
    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
    );
    await db.$client.execute(
      "INSERT INTO shares (id, project_id, audience_name, mode, token_hash, permissions, policy, created_at) VALUES ('s1','p1','A','invite','h','{}','{}',0)",
    );
    await db.$client.execute(
      "INSERT INTO guest_sessions (id, share_id, project_id, name, token_hash, created_at) VALUES ('gs1','s1','p1','Alex','gh',0)",
    );

    await applyMigrationSqlRaw(db, last);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);

    const shares = await db.$client.execute('SELECT id, project_id, workspace_id FROM shares');
    expect(shares.rows).toEqual([{ id: 's1', project_id: 'p1', workspace_id: null }]);
    const guests = await db.$client.execute(
      'SELECT id, share_id, project_id, workspace_id FROM guest_sessions',
    );
    expect(guests.rows).toEqual([{ id: 'gs1', share_id: 's1', project_id: 'p1', workspace_id: null }]);
  });
});
