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
    expect(await hasColumn(db, 'edges', 'from_type')).toBe(true);
    expect(await hasColumn(db, 'edges', 'from_id')).toBe(true);
    expect(await hasColumn(db, 'edges', 'to_type')).toBe(true);
    expect(await hasColumn(db, 'edges', 'to_id')).toBe(true);
    expect(await hasColumn(db, 'edges', 'from_task_id')).toBe(false);
    expect(await hasColumn(db, 'edges', 'to_task_id')).toBe(false);
    expect(await hasColumn(db, 'documents', 'linked_task_id')).toBe(false);
    // Typed edge endpoints are NOT NULL on a fresh database.
    const edgeInfo = await db.$client.execute('PRAGMA table_info(edges)');
    for (const col of ['from_type', 'from_id', 'to_type', 'to_id'] as const) {
      const row = edgeInfo.rows.find((r) => r.name === col);
      expect(row?.notnull).toBe(1);
    }
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
    const idx = files.indexOf('0002_ws_share.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx]!;

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

    await applyMigrationSqlRaw(db, target);
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

  // Expand: polymorphic edge columns + document→task backfill. Task FK columns stay.
  it('0003 backfills poly columns and document→task edges without losing rows', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0003_poly_edges.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx]!;

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective) VALUES ('g1','p1','Ship')",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label) VALUES ('t1','p1','g1','From')",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label) VALUES ('t2','p1','g1','To')",
    );
    await db.$client.execute(
      "INSERT INTO edges (id, project_id, from_task_id, to_task_id, label) VALUES ('e1','p1','t1','t2','blocks')",
    );
    await db.$client.execute(
      "INSERT INTO documents (id, project_id, title, linked_task_id) VALUES ('d1','p1','Spec','t1')",
    );
    await db.$client.execute(
      "INSERT INTO documents (id, project_id, title, linked_task_id) VALUES ('d2','p1','Notes',NULL)",
    );

    const edgesBefore = await db.$client.execute('SELECT COUNT(*) AS n FROM edges');
    const docsLinkedBefore = await db.$client.execute(
      'SELECT COUNT(*) AS n FROM documents WHERE linked_task_id IS NOT NULL',
    );
    const beforeCount = Number(edgesBefore.rows[0]?.n);
    const linkedDocCount = Number(docsLinkedBefore.rows[0]?.n);
    expect(beforeCount).toBe(1);
    expect(linkedDocCount).toBe(1);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);

    const edgesAfter = await db.$client.execute(
      'SELECT id, from_task_id, to_task_id, from_type, from_id, to_type, to_id, label FROM edges ORDER BY id',
    );
    expect(edgesAfter.rows).toHaveLength(beforeCount + linkedDocCount);

    const taskEdge = edgesAfter.rows.find((row) => row.id === 'e1');
    expect(taskEdge).toEqual({
      id: 'e1',
      from_task_id: 't1',
      to_task_id: 't2',
      from_type: 'task',
      from_id: 't1',
      to_type: 'task',
      to_id: 't2',
      label: 'blocks',
    });

    const docEdges = edgesAfter.rows.filter((row) => row.from_type === 'document');
    expect(docEdges).toHaveLength(1);
    expect(docEdges[0]).toMatchObject({
      from_type: 'document',
      from_id: 'd1',
      to_type: 'task',
      to_id: 't1',
      label: 'documents',
      // from_task_id/to_task_id remain NOT NULL — filled with linked task for FK safety
      from_task_id: 't1',
      to_task_id: 't1',
    });

    const docEdgeFull = await db.$client.execute(
      "SELECT project_id, from_type, from_id, to_type, to_id, label FROM edges WHERE from_type = 'document'",
    );
    expect(docEdgeFull.rows).toEqual([
      {
        project_id: 'p1',
        from_type: 'document',
        from_id: 'd1',
        to_type: 'task',
        to_id: 't1',
        label: 'documents',
      },
    ]);

    // Expand leaves the legacy column; contract (0005) drops it later.
    expect(await hasColumn(db, 'documents', 'linked_task_id')).toBe(true);
    expect(await hasColumn(db, 'edges', 'from_task_id')).toBe(true);
    const linkedStill = await db.$client.execute(
      "SELECT linked_task_id FROM documents WHERE id = 'd1'",
    );
    expect(linkedStill.rows[0]?.linked_task_id).toBe('t1');
  });

  it('0003 is a no-op on a database with zero edges and zero linked documents', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0003_poly_edges.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx]!;

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }
    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
    );

    const before = await db.$client.execute('SELECT COUNT(*) AS n FROM edges');
    expect(Number(before.rows[0]?.n)).toBe(0);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);

    const after = await db.$client.execute('SELECT COUNT(*) AS n FROM edges');
    expect(Number(after.rows[0]?.n)).toBe(0);
    expect(await hasColumn(db, 'edges', 'from_type')).toBe(true);
    expect(await hasColumn(db, 'edges', 'to_id')).toBe(true);
  });

  // Contract: an already-migrated (expand-era) database and a fresh database
  // converge to the same final shape — no legacy link columns, typed endpoints NOT NULL.
  it('0005 contracts a populated expand-era database and converges with a fresh migrate', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0005_contract_drop_legacy_link_cols.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx]!;

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective) VALUES ('g1','p1','Ship')",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label) VALUES ('t1','p1','g1','From')",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label) VALUES ('t2','p1','g1','To')",
    );
    // Expand-era task→task edge (typed filled, legacy still present).
    await db.$client.execute(
      "INSERT INTO edges (id, project_id, from_task_id, to_task_id, from_type, from_id, to_type, to_id, label) VALUES ('e1','p1','t1','t2','task','t1','task','t2','blocks')",
    );
    // Document with legacy primary and its dual-written edge.
    await db.$client.execute(
      "INSERT INTO documents (id, project_id, title, linked_task_id) VALUES ('d1','p1','Spec','t1')",
    );
    await db.$client.execute(
      "INSERT INTO edges (id, project_id, from_task_id, to_task_id, from_type, from_id, to_type, to_id, label) VALUES ('e2','p1',NULL,NULL,'document','d1','task','t1','documents')",
    );
    // Document whose dual-write edge is missing — contract must re-materialise it.
    await db.$client.execute(
      "INSERT INTO documents (id, project_id, title, linked_task_id) VALUES ('d2','p1','Orphan link','t2')",
    );

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);

    expect(await hasColumn(db, 'edges', 'from_task_id')).toBe(false);
    expect(await hasColumn(db, 'edges', 'to_task_id')).toBe(false);
    expect(await hasColumn(db, 'documents', 'linked_task_id')).toBe(false);

    const edgeInfo = await db.$client.execute('PRAGMA table_info(edges)');
    for (const col of ['from_type', 'from_id', 'to_type', 'to_id'] as const) {
      const row = edgeInfo.rows.find((r) => r.name === col);
      expect(row?.notnull).toBe(1);
    }

    const edges = await db.$client.execute(
      'SELECT id, from_type, from_id, to_type, to_id, label FROM edges ORDER BY from_type, from_id, to_id',
    );
    expect(edges.rows).toEqual(
      expect.arrayContaining([
        {
          id: 'e1',
          from_type: 'task',
          from_id: 't1',
          to_type: 'task',
          to_id: 't2',
          label: 'blocks',
        },
        {
          id: 'e2',
          from_type: 'document',
          from_id: 'd1',
          to_type: 'task',
          to_id: 't1',
          label: 'documents',
        },
        expect.objectContaining({
          from_type: 'document',
          from_id: 'd2',
          to_type: 'task',
          to_id: 't2',
          label: 'documents',
        }),
      ]),
    );
    expect(edges.rows).toHaveLength(3);

    // Fresh migrate() must arrive at the identical domain schema shape for edges/documents.
    // (Raw SQL path does not create __drizzle_migrations; compare domain tables only.)
    const fresh = await createDb(':memory:');
    await migrate(fresh);
    const shape = async (client: Awaited<ReturnType<typeof createDb>>) => {
      const tables = (await listTables(client)).filter((t) => t !== '__drizzle_migrations').sort();
      const edgeCols = (await client.$client.execute('PRAGMA table_info(edges)')).rows
        .map((r) => `${String(r.name)}:${String(r.notnull)}`)
        .sort();
      const docCols = (await client.$client.execute('PRAGMA table_info(documents)')).rows
        .map((r) => `${String(r.name)}:${String(r.notnull)}`)
        .sort();
      return { tables, edgeCols, docCols };
    };
    expect(await shape(db)).toEqual(await shape(fresh));
  });
});
