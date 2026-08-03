import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { createTask } from './repositories/tasks.js';
import { assertTaskCreateSchema } from './task-schema-guards.js';
import {
  assertSchemaCurrent,
  getSchemaMigrationSummary,
  listShippedMigrationTags,
  SchemaDriftError,
} from './schema-drift.js';
import { UnstoredColumnError } from './schema-columns.js';

const drizzleDir = new URL('../drizzle/', import.meta.url);

async function applyMigrationSqlRaw(
  db: Awaited<ReturnType<typeof createDb>>,
  file: string,
): Promise<void> {
  const sql = readFileSync(new URL(file, drizzleDir), 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    await db.$client.execute(stmt);
  }
}

async function hasColumn(
  db: Awaited<ReturnType<typeof createDb>>,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await db.$client.execute(`PRAGMA table_info(${table})`);
  return result.rows.some((row) => row.name === column);
}

describe('schema drift', () => {
  it('reports current after migrate on a fresh database', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const summary = await getSchemaMigrationSummary(db);
    expect(summary.current).toBe(true);
    expect(summary.applied).toBe(listShippedMigrationTags().length);
    expect(summary.missingTags).toEqual([]);
    await assertSchemaCurrent(db);
  });

  it('refuses to serve when applied migrations trail the shipped set', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0007_blushing_raza.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const file of preamble) {
      await applyMigrationSqlRaw(db, file);
    }
    await db.$client.execute('PRAGMA foreign_keys = ON');

    expect(await hasColumn(db, 'tasks', 'kind')).toBe(false);
    const summary = await getSchemaMigrationSummary(db);
    expect(summary.current).toBe(false);
    expect(summary.missingTags.length).toBeGreaterThan(0);
    await expect(assertSchemaCurrent(db)).rejects.toBeInstanceOf(SchemaDriftError);
  });
});

describe('task writes on a stale tasks schema', () => {
  it('rejects create_task when kind cannot be stored', async () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = files.indexOf('0008_woozy_colossus.sql');
    expect(idx).toBeGreaterThan(0);
    const preamble = files.slice(0, idx);
    const db = await createDb(':memory:');
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    for (const file of preamble) {
      await applyMigrationSqlRaw(db, file);
    }
    await db.$client.execute('PRAGMA foreign_keys = ON');
    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path) VALUES ('p1','o1','w1','Project',NULL,NULL,100,200,NULL,NULL)",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective, status, verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget, last_verification, created_at, updated_at) VALUES ('g1','p1','Ship','active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,100,200)",
    );

    expect(await hasColumn(db, 'tasks', 'kind')).toBe(false);
    await expect(assertTaskCreateSchema(db)).rejects.toBeInstanceOf(UnstoredColumnError);
  });

  it('round-trips kind and priority after migrate', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await db.$client.execute(
      "INSERT INTO projects (id, org_id, workspace_id, name, description, canvas_layout, created_at, updated_at, repo_url, folder_path) VALUES ('p1','o1','w1','Project',NULL,NULL,100,200,NULL,NULL)",
    );
    await db.$client.execute(
      "INSERT INTO goals (id, project_id, objective, status, verification_surface, constraints, boundaries, iteration_policy, stop_condition, budget, last_verification, created_at, updated_at) VALUES ('g1','p1','Ship','active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,100,200)",
    );
    const created = await createTask(db, {
      projectId: 'p1',
      goalId: 'g1',
      label: 'Decision task',
      kind: 'decision',
      priority: 'high',
    });
    expect(created.kind).toBe('decision');
    expect(created.priority).toBe('high');
  });
});
