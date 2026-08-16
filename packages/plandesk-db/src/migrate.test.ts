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
async function applyMigrationSqlRaw(
  db: Awaited<ReturnType<typeof createDb>>,
  file: string,
): Promise<void> {
  const sql = readFileSync(new URL(file, drizzleDir), 'utf8');
  for (const stmt of sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)) {
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
  'revisions',
  'agent_runs',
  'agent_run_events',
  'shares',
  'guest_sessions',
  'share_submissions',
  'sync_state',
  'sync_remotes',
  'files',
  'artifacts',
  'prototypes',
  '__drizzle_migrations',
] as const;

const LEGACY_TABLES = ['orgs', 'org_members', 'sessions', 'pending_auth', 'mcp_tokens'] as const;

/**
 * libSQL cells are `string | number | bigint | ArrayBuffer | null`. The schema
 * metadata we read here is always text or integer, so narrow instead of
 * `String()`-ing — an ArrayBuffer would silently become "[object Object]" and
 * compare equal across genuinely different schemas.
 */
function cell(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error(`expected a scalar column value, got ${typeof value}`);
}

async function listTables(db: Awaited<ReturnType<typeof createDb>>): Promise<string[]> {
  const result = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return result.rows.map((row) => cell(row.name));
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
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

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
    expect(guests.rows).toEqual([
      { id: 'gs1', share_id: 's1', project_id: 'p1', workspace_id: null },
    ]);
  });

  // Expand: polymorphic edge columns + document→task backfill. Task FK columns stay.
  it('0003 backfills poly columns and document→task edges without losing rows', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0003_poly_edges.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

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
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

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
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

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

    // Same migration chain on a fresh database must converge to the identical 0005-era shape.
    const fresh = await createDb(':memory:');
    await fresh.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(fresh, f);
    }
    await applyMigrationSqlRaw(fresh, target);
    await fresh.$client.execute('PRAGMA foreign_keys = ON');
    const shape = async (client: Awaited<ReturnType<typeof createDb>>) => {
      const tables = (await listTables(client)).filter((t) => t !== '__drizzle_migrations').sort();
      const edgeCols = (await client.$client.execute('PRAGMA table_info(edges)')).rows
        .map((r) => `${cell(r.name)}:${cell(r.notnull)}`)
        .sort();
      const docCols = (await client.$client.execute('PRAGMA table_info(documents)')).rows
        .map((r) => `${cell(r.name)}:${cell(r.notnull)}`)
        .sort();
      return { tables, edgeCols, docCols };
    };
    expect(await shape(db)).toEqual(await shape(fresh));
  });

  // Regression: 0006 only ADDs two nullable columns. A row that existed at 0005
  // must survive unchanged (including documents/edges) with the new cols null.
  // An earlier buggy migration that dropped/recreated documents+edges stayed
  // green because every test inserted rows only after full migrate().
  it('0006 preserves pre-existing projects, documents, and edges', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0006_oval_silhouette.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at) VALUES ('p1','o1','w1','Pre-0006','Known desc','{\"x\":1}',100,200)",
    );
    await db.$client.execute(
      "INSERT INTO documents (id, project_id, title, body, status_line, parent_id, folder_id, created_at, updated_at) VALUES ('d1','p1','Spec','# Body','draft',NULL,NULL,300,400)",
    );
    await db.$client.execute(
      "INSERT INTO edges (id, project_id, from_type, from_id, to_type, to_id, label, arrow_direction, style, created_at) VALUES ('e1','p1','document','d1','document','d1','references',NULL,'solid',500)",
    );

    const projectBefore = await db.$client.execute(
      "SELECT id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at FROM projects WHERE id = 'p1'",
    );
    const docBefore = await db.$client.execute(
      "SELECT id, project_id, title, body, status_line, parent_id, folder_id, created_at, updated_at FROM documents WHERE id = 'd1'",
    );
    const edgeBefore = await db.$client.execute(
      "SELECT id, project_id, from_type, from_id, to_type, to_id, label, arrow_direction, style, created_at FROM edges WHERE id = 'e1'",
    );
    expect(projectBefore.rows).toHaveLength(1);
    expect(docBefore.rows).toHaveLength(1);
    expect(edgeBefore.rows).toHaveLength(1);

    expect(await hasColumn(db, 'projects', 'repo_url')).toBe(false);
    expect(await hasColumn(db, 'projects', 'folder_path')).toBe(false);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);

    expect(await hasColumn(db, 'projects', 'repo_url')).toBe(true);
    expect(await hasColumn(db, 'projects', 'folder_path')).toBe(true);

    const projectAfter = await db.$client.execute(
      "SELECT id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path FROM projects WHERE id = 'p1'",
    );
    expect(projectAfter.rows).toEqual([
      {
        ...projectBefore.rows[0],
        repo_url: null,
        folder_path: null,
      },
    ]);

    const docAfter = await db.$client.execute(
      "SELECT id, project_id, title, body, status_line, parent_id, folder_id, created_at, updated_at FROM documents WHERE id = 'd1'",
    );
    expect(docAfter.rows).toEqual(docBefore.rows);

    const edgeAfter = await db.$client.execute(
      "SELECT id, project_id, from_type, from_id, to_type, to_id, label, arrow_direction, style, created_at FROM edges WHERE id = 'e1'",
    );
    expect(edgeAfter.rows).toEqual(edgeBefore.rows);
  });

  // Regression: 0007 only ADDs commit_refs. A task that existed at 0006 must
  // survive with the new column null.
  it('0007 preserves pre-existing tasks and adds commit_refs as null', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0007_blushing_raza.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path) VALUES ('p1','o1','w1','Pre-0007',NULL,NULL,100,200,NULL,NULL)",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective, status, verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget, last_verification, created_at, updated_at) VALUES ('g1','p1','Ship','active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,100,200)",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label, status, description, x, y, assignee, due_date, created_at, updated_at) VALUES ('t1','p1','g1','Trace me','todo',NULL,0,0,NULL,NULL,100,200)",
    );

    expect(await hasColumn(db, 'tasks', 'commit_refs')).toBe(false);

    const taskBefore = await db.$client.execute(
      "SELECT id, project_id, goal_id, label, status, description, x, y, assignee, due_date, created_at, updated_at FROM tasks WHERE id = 't1'",
    );
    expect(taskBefore.rows).toHaveLength(1);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);

    expect(await hasColumn(db, 'tasks', 'commit_refs')).toBe(true);

    const taskAfter = await db.$client.execute(
      "SELECT id, project_id, goal_id, label, status, description, x, y, assignee, due_date, created_at, updated_at, commit_refs FROM tasks WHERE id = 't1'",
    );
    expect(taskAfter.rows).toEqual([
      {
        ...taskBefore.rows[0],
        commit_refs: null,
      },
    ]);
  });

  it('0009 adds revisions table on a populated database', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0009_thick_valeria_richards.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p1','o1','w1','P')",
    );

    expect(await hasColumn(db, 'revisions', 'author')).toBe(false);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);
    expect(await hasColumn(db, 'revisions', 'author')).toBe(true);
    expect((await listTables(db)).includes('revisions')).toBe(true);
  });

  // Regression: 0010 only ADDs nullable priority (plus an additive severity-tag
  // backfill). A task that existed at 0009 must survive with priority null when
  // it has no severity:* tag; severity:high maps to high and keeps the tag.
  it('0010 preserves pre-existing tasks as null priority and backfills severity tags', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0010_smart_sphinx.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path) VALUES ('p1','o1','w1','Pre-0010',NULL,NULL,100,200,NULL,NULL)",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective, status, verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget, last_verification, created_at, updated_at) VALUES ('g1','p1','Ship','active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,100,200)",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label, status, kind, description, x, y, assignee, due_date, commit_refs, created_at, updated_at) VALUES ('t-plain','p1','g1','Plain','todo','build',NULL,0,0,NULL,NULL,NULL,100,200)",
    );
    await db.$client.execute(
      "INSERT INTO tasks (id, project_id, goal_id, label, status, kind, description, x, y, assignee, due_date, commit_refs, created_at, updated_at) VALUES ('t-sev','p1','g1','Tagged','todo','build',NULL,0,0,NULL,NULL,NULL,100,200)",
    );
    await db.$client.execute(
      "INSERT INTO tags (id, project_id, name, color, created_at) VALUES ('tag-sev','p1','severity:high',NULL,100)",
    );
    await db.$client.execute("INSERT INTO task_tags (task_id, tag_id) VALUES ('t-sev','tag-sev')");

    expect(await hasColumn(db, 'tasks', 'priority')).toBe(false);

    const plainBefore = await db.$client.execute(
      "SELECT id, project_id, goal_id, label, status, kind, description, x, y, assignee, due_date, commit_refs, created_at, updated_at FROM tasks WHERE id = 't-plain'",
    );
    expect(plainBefore.rows).toHaveLength(1);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);
    expect(await hasColumn(db, 'tasks', 'priority')).toBe(true);

    const plainAfter = await db.$client.execute(
      "SELECT id, project_id, goal_id, label, status, kind, description, x, y, assignee, due_date, commit_refs, created_at, updated_at, priority FROM tasks WHERE id = 't-plain'",
    );
    expect(plainAfter.rows).toEqual([
      {
        ...plainBefore.rows[0],
        priority: null,
      },
    ]);

    const sevAfter = await db.$client.execute(
      "SELECT id, label, priority FROM tasks WHERE id = 't-sev'",
    );
    expect(sevAfter.rows).toEqual([{ id: 't-sev', label: 'Tagged', priority: 'high' }]);

    // Tag stays attached.
    const tagStillThere = await db.$client.execute(
      "SELECT task_id, tag_id FROM task_tags WHERE task_id = 't-sev'",
    );
    expect(tagStillThere.rows).toEqual([{ task_id: 't-sev', tag_id: 'tag-sev' }]);

    // Re-running the severity backfill UPDATEs alone is a no-op (idempotent).
    const backfillOnly = readFileSync(new URL(target, drizzleDir), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('UPDATE'));
    expect(backfillOnly.length).toBeGreaterThan(0);
    for (const stmt of backfillOnly) {
      await db.$client.execute(stmt);
    }
    const sevAgain = await db.$client.execute("SELECT id, priority FROM tasks WHERE id = 't-sev'");
    expect(sevAgain.rows).toEqual([{ id: 't-sev', priority: 'high' }]);
    const plainStillNull = await db.$client.execute(
      "SELECT priority FROM tasks WHERE id = 't-plain'",
    );
    expect(plainStillNull.rows).toEqual([{ priority: null }]);
  });

  it('0017 backfills unambiguous lane and severity tags and reports conflicts', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0017_robust_old_lace.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }
    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name) VALUES ('p17','o17','w17','P17')",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective, status) VALUES ('g17','p17','Ship','active')",
    );
    for (const id of ['t-auto', 't-conflict', 't-sev', 't-sev-conflict']) {
      await db.$client.execute(
        `INSERT INTO tasks (id, project_id, goal_id, label, status, kind, priority, description, x, y, created_at, updated_at) VALUES ('${id}','p17','g17','${id}','todo','build',NULL,NULL,0,0,100,100)`,
      );
    }
    const tags: Array<[string, string]> = [
      ['lane-auto', 'lane:auto'],
      ['lane-approve', 'lane:approve'],
      ['lane-full', 'lane:full'],
      ['sev-high', 'sev:high'],
      ['severity-high', 'severity:high'],
      ['sev-low', 'sev:low'],
    ];
    for (const [id, name] of tags) {
      await db.$client.execute(
        `INSERT INTO tags (id, project_id, name, color, created_at) VALUES ('${id}','p17','${name}',NULL,100)`,
      );
    }
    await db.$client.execute(
      "INSERT INTO task_tags (task_id, tag_id) VALUES ('t-auto','lane-auto')",
    );
    await db.$client.execute(
      "INSERT INTO task_tags (task_id, tag_id) VALUES ('t-conflict','lane-approve'), ('t-conflict','lane-full')",
    );
    await db.$client.execute("INSERT INTO task_tags (task_id, tag_id) VALUES ('t-sev','sev-high')");
    await db.$client.execute(
      "INSERT INTO task_tags (task_id, tag_id) VALUES ('t-sev-conflict','sev-high'), ('t-sev-conflict','sev-low')",
    );

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');
    expect(await hasColumn(db, 'tasks', 'lane')).toBe(true);
    expect(await hasColumn(db, 'tasks', 'severity')).toBe(true);
    const values = await db.$client.execute(
      "SELECT id, lane, severity FROM tasks WHERE project_id = 'p17' ORDER BY id",
    );
    expect(values.rows).toEqual([
      { id: 't-auto', lane: 'auto', severity: null },
      { id: 't-conflict', lane: null, severity: null },
      { id: 't-sev', lane: null, severity: 'high' },
      { id: 't-sev-conflict', lane: null, severity: null },
    ]);
    const conflicts = await db.$client.execute(
      'SELECT task_id, field, tag_values FROM task_field_migration_conflicts ORDER BY task_id, field',
    );
    expect(conflicts.rows).toEqual([
      { task_id: 't-conflict', field: 'lane', tag_values: 'approve,full' },
      { task_id: 't-sev-conflict', field: 'severity', tag_values: 'high,low' },
    ]);
    const tagsRemain = await db.$client.execute(
      "SELECT count(*) AS count FROM task_tags WHERE task_id IN ('t-auto','t-conflict','t-sev','t-sev-conflict')",
    );
    expect(tagsRemain.rows).toEqual([{ count: 6 }]);
  });

  // Regression: 0012 only ADDs nullable owner_id and overview_document_id.
  // A project that existed at 0011 must survive with both columns null.
  it('0012 preserves pre-existing projects as null owner and overview', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0012_long_ted_forrester.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path) VALUES ('p1','o1','w1','Pre-0012',NULL,NULL,100,200,NULL,NULL)",
    );

    expect(await hasColumn(db, 'projects', 'owner_id')).toBe(false);
    expect(await hasColumn(db, 'projects', 'overview_document_id')).toBe(false);

    const before = await db.$client.execute(
      "SELECT id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path FROM projects WHERE id = 'p1'",
    );
    expect(before.rows).toHaveLength(1);

    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);
    expect(await hasColumn(db, 'projects', 'owner_id')).toBe(true);
    expect(await hasColumn(db, 'projects', 'overview_document_id')).toBe(true);

    const after = await db.$client.execute(
      "SELECT id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path, owner_id, overview_document_id FROM projects WHERE id = 'p1'",
    );
    expect(after.rows).toEqual([
      {
        ...before.rows[0],
        owner_id: null,
        overview_document_id: null,
      },
    ]);
  });

  // 0013 is additive: CREATE TABLE prototypes + three nullable columns on artifacts.
  // Prove up → down → up against rows that already exist, with referencing rows present.
  it('0013 up → down → up preserves artifacts and re-applies cleanly', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0013_flimsy_sharon_ventura.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const target = files[idx];
    if (target === undefined) {
      throw new Error(`no migration file at index ${String(idx)}`);
    }

    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const f of preamble) {
      await applyMigrationSqlRaw(db, f);
    }

    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path) VALUES ('p1','o1','w1','Pre-0013',NULL,NULL,100,200,NULL,NULL)",
    );
    await db.$client.execute(
      "INSERT INTO artifacts (id, project_id, title, kind, content, created_at, updated_at) VALUES ('a1','p1','Report','markdown','# hi',100,200)",
    );

    expect(await hasColumn(db, 'artifacts', 'prototype_id')).toBe(false);
    expect((await listTables(db)).includes('prototypes')).toBe(false);

    // UP
    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');
    expect(await hasColumn(db, 'artifacts', 'prototype_id')).toBe(true);
    expect(await hasColumn(db, 'artifacts', 'x')).toBe(true);
    expect(await hasColumn(db, 'artifacts', 'y')).toBe(true);
    expect((await listTables(db)).includes('prototypes')).toBe(true);

    await db.$client.execute(
      "INSERT INTO prototypes (id, project_id, name, viewport_width, viewport_height, created_at, updated_at) VALUES ('proto1','p1','Flow',390,844,100,200)",
    );
    await db.$client.execute(
      "UPDATE artifacts SET prototype_id = 'proto1', x = 12.5, y = 34.5, kind = 'html' WHERE id = 'a1'",
    );

    const mid = await db.$client.execute(
      "SELECT id, title, kind, prototype_id, x, y FROM artifacts WHERE id = 'a1'",
    );
    expect(mid.rows).toEqual([
      { id: 'a1', title: 'Report', kind: 'html', prototype_id: 'proto1', x: 12.5, y: 34.5 },
    ]);

    // DOWN — clear FKs, drop columns, drop table (additive reverse)
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    await db.$client.execute('UPDATE artifacts SET prototype_id = NULL, x = NULL, y = NULL');
    await db.$client.execute('ALTER TABLE artifacts DROP COLUMN prototype_id');
    await db.$client.execute('ALTER TABLE artifacts DROP COLUMN x');
    await db.$client.execute('ALTER TABLE artifacts DROP COLUMN y');
    await db.$client.execute('DROP TABLE prototypes');

    expect(await hasColumn(db, 'artifacts', 'prototype_id')).toBe(false);
    expect((await listTables(db)).includes('prototypes')).toBe(false);
    const afterDown = await db.$client.execute(
      "SELECT id, title, kind FROM artifacts WHERE id = 'a1'",
    );
    expect(afterDown.rows).toEqual([{ id: 'a1', title: 'Report', kind: 'html' }]);

    // UP again
    await applyMigrationSqlRaw(db, target);
    await db.$client.execute('PRAGMA foreign_keys = ON');
    const fkCheck = await db.$client.execute('PRAGMA foreign_key_check');
    expect(fkCheck.rows).toHaveLength(0);
    expect(await hasColumn(db, 'artifacts', 'prototype_id')).toBe(true);
    expect((await listTables(db)).includes('prototypes')).toBe(true);

    const afterUp = await db.$client.execute(
      "SELECT id, title, kind, prototype_id, x, y FROM artifacts WHERE id = 'a1'",
    );
    expect(afterUp.rows).toEqual([
      { id: 'a1', title: 'Report', kind: 'html', prototype_id: null, x: null, y: null },
    ]);
  });
});
