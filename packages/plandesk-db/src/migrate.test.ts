import { describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { migrate, migrateDown, migrateDownAll } from './migrate.js';
import { seed, FIXTURE_PROJECT_ID } from './seed.js';
import { getProject } from './repositories/projects.js';
import { randomUUID } from 'node:crypto';
import {
  createProjectInDefaultOrg as createProject,
  createTaskWithDefaultGoal as createTask,
} from './testing.js';

async function insertLegacyTask(db: Db, projectId: string, label: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await db.$client.execute({
    sql: `INSERT INTO tasks (id, project_id, label, status, x, y, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 0, 0, ?, ?)`,
    args: [id, projectId, label, now, now],
  });
  return id;
}

const EXPECTED_TABLES = [
  'projects',
  'orgs',
  'org_members',
  'sessions',
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
  'mcp_tokens',
  'shares',
  'guest_sessions',
  'share_submissions',
  'sync_state',
  'sync_remotes',
  'files',
  'artifacts',
  '__drizzle_migrations',
] as const;

const APP_TABLES = EXPECTED_TABLES.filter((table) => table !== '__drizzle_migrations');

async function listTables(db: Db): Promise<string[]> {
  const result = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  const result = await db.$client.execute(`PRAGMA table_info(${table})`);
  return result.rows.some((row) => row.name === column);
}

describe('migrate', () => {
  it('creates all RFC §4.4 tables on a fresh database', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('is idempotent when run twice', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const afterFirst = await listTables(db);
    await expect(migrate(db)).resolves.not.toThrow();
    expect(await listTables(db)).toEqual(afterFirst);
  });

  it('regression: migrate up/down on empty database', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    expect(await listTables(db)).toEqual(expect.arrayContaining([...APP_TABLES]));
    expect(await hasColumn(db, 'projects', 'canvas_layout')).toBe(true);

    await migrateDownAll(db);
    expect(await listTables(db)).not.toContain('projects');
    expect(await listTables(db)).not.toContain('tasks');

    await migrate(db);
    expect(await listTables(db)).toEqual(expect.arrayContaining([...APP_TABLES]));
    expect(await hasColumn(db, 'projects', 'canvas_layout')).toBe(true);
  });

  it('regression: migrate up/down on seeded database', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await seed(db);
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.name).toBe('Fixture Project');

    await migrateDown(db, 1); // 0017 guest_sessions
    expect(await listTables(db)).not.toContain('guest_sessions');

    await migrateDown(db, 1); // 0016 pending_auth
    expect(await hasColumn(db, 'comments', 'anchor')).toBe(true);
    expect(await hasColumn(db, 'projects', 'org_id')).toBe(true);

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('sessions');

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('orgs');
    expect(await listTables(db)).not.toContain('org_members');
    expect(await hasColumn(db, 'projects', 'org_id')).toBe(false);

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('artifacts');

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('files');

    await migrateDown(db, 1);
    expect(await hasColumn(db, 'comments', 'anchor')).toBe(false);
    expect(await listTables(db)).toContain('comments');

    await migrateDown(db, 1);
    expect(await listTables(db)).toContain('document_comments');
    expect(await listTables(db)).not.toContain('comments');

    await migrateDown(db, 1);
    expect(await hasColumn(db, 'goals', 'last_verification')).toBe(false);

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('goals');
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(false);

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('tags');
    expect(await listTables(db)).not.toContain('task_tags');
    expect(await listTables(db)).toContain('folders');

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('folders');
    expect(await hasColumn(db, 'documents', 'folder_id')).toBe(false);

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('notes');

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('sync_remotes');

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('share_submissions');
    expect(await listTables(db)).not.toContain('sync_state');

    await migrateDown(db, 1);
    expect(await listTables(db)).not.toContain('shares');

    await migrateDown(db, 1);
    expect(await hasColumn(db, 'projects', 'canvas_layout')).toBe(false);

    await migrate(db);
    expect(await hasColumn(db, 'projects', 'canvas_layout')).toBe(true);
    expect(await hasColumn(db, 'projects', 'org_id')).toBe(true);
    expect(await listTables(db)).toContain('orgs');
    expect(await listTables(db)).toContain('shares');
    expect(await listTables(db)).toContain('share_submissions');
    expect(await listTables(db)).toContain('sync_state');
    expect(await listTables(db)).toContain('sync_remotes');
    expect(await listTables(db)).toContain('notes');
    expect(await listTables(db)).toContain('folders');
    expect(await hasColumn(db, 'documents', 'folder_id')).toBe(true);
    expect(await listTables(db)).toContain('tags');
    expect(await listTables(db)).toContain('task_tags');
    expect(await listTables(db)).toContain('goals');
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(true);
    expect(await hasColumn(db, 'goals', 'last_verification')).toBe(true);
    expect(await listTables(db)).toContain('comments');
    expect(await hasColumn(db, 'comments', 'anchor')).toBe(true);
    expect(await listTables(db)).toContain('artifacts');
    expect(await listTables(db)).toContain('sessions');
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.name).toBe('Fixture Project');

    await migrateDownAll(db);
    expect(await listTables(db)).not.toContain('projects');

    await migrate(db);
    await seed(db);
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.name).toBe('Fixture Project');
  });

  it('0008 backfill assigns a default goal to pre-existing tasks', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    // 0017+0016+0015+0014+0013+0012+0011+0010+0009+0008 = 10 downs to pre-goals schema
    await migrateDown(db, 10);
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(false);
    expect(await listTables(db)).not.toContain('goals');

    // Schema is pre-orgs; insert project with the pre-0014 shape.
    const projectId = randomUUID();
    const now = Date.now();
    await db.$client.execute({
      sql: `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      args: [projectId, 'Legacy project', now, now],
    });
    const project = { id: projectId };
    const legacyTaskId = await insertLegacyTask(db, project.id, 'Legacy task');

    await migrate(db);
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(true);
    expect(await listTables(db)).toContain('goals');

    const taskRow = (
      await db.$client.execute({
        sql: 'SELECT goal_id FROM tasks WHERE id = ?',
        args: [legacyTaskId],
      })
    ).rows[0];
    expect(taskRow).toBeDefined();
    const goalRow = (
      await db.$client.execute({
        sql: 'SELECT objective, project_id FROM goals WHERE id = ?',
        args: [String(taskRow?.goal_id)],
      })
    ).rows[0];
    expect(goalRow).toBeDefined();

    expect(goalRow?.objective).toBe('General');
    expect(goalRow?.project_id).toBe(project.id);
  });

  it('regression: 0008 migrate down then up on database with tasks', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Down up project' });
    await createTask(db, { projectId: project.id, label: 'Task A' });
    await createTask(db, { projectId: project.id, label: 'Task B' });

    await migrateDown(db, 10);
    expect(await listTables(db)).not.toContain('goals');
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(false);

    await migrate(db);
    expect(await listTables(db)).toContain('goals');
    expect(await hasColumn(db, 'tasks', 'goal_id')).toBe(true);

    const tasks = (
      await db.$client.execute({
        sql: 'SELECT goal_id FROM tasks WHERE project_id = ?',
        args: [project.id],
      })
    ).rows;
    expect(tasks).toHaveLength(2);
    const goalIds = new Set(tasks.map((task) => String(task.goal_id)));
    expect(goalIds.size).toBe(1);
    const goalId = [...goalIds][0];
    expect(goalId).toBeDefined();
    const goal = (
      await db.$client.execute({
        sql: 'SELECT objective FROM goals WHERE id = ?',
        args: [goalId ?? ''],
      })
    ).rows[0];
    expect(goal?.objective).toBe('General');
  });

  it('0010 backfill migrates document_comments to comments with project_id', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    // 0017+0016+0015+0014+0013+0012+0011+0010 = 8 downs to document_comments schema
    await migrateDown(db, 8);
    expect(await listTables(db)).toContain('document_comments');
    expect(await listTables(db)).not.toContain('comments');

    // Pre-orgs schema — insert project via raw SQL.
    const projectId = randomUUID();
    const now = Date.now();
    await db.$client.execute({
      sql: `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      args: [projectId, 'Legacy comments', now, now],
    });
    const project = { id: projectId };
    const docId = randomUUID();
    const commentId = randomUUID();
    await db.$client.execute({
      sql: `INSERT INTO documents (id, project_id, title, created_at, updated_at)
         VALUES (?, ?, 'Legacy doc', ?, ?)`,
      args: [docId, project.id, now, now],
    });
    await db.$client.execute({
      sql: `INSERT INTO document_comments (id, document_id, passage, body, resolved, created_at)
         VALUES (?, ?, 'p1', 'Legacy note', 0, ?)`,
      args: [commentId, docId, now],
    });

    await migrate(db);
    expect(await listTables(db)).toContain('comments');
    expect(await listTables(db)).not.toContain('document_comments');

    const row = (
      await db.$client.execute({
        sql: 'SELECT id, project_id, target_type, target_id, passage, body, resolved FROM comments WHERE id = ?',
        args: [commentId],
      })
    ).rows[0];
    expect(row).toBeDefined();
    expect(row?.project_id).toBe(project.id);
    expect(row?.target_type).toBe('document');
    expect(row?.target_id).toBe(docId);
    expect(row?.passage).toBe('p1');
    expect(row?.body).toBe('Legacy note');
    expect(row?.resolved).toBe(0);
  });

  it('regression: 0010 migrate down then up restores document_comments', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    expect(await listTables(db)).toContain('comments');
    expect(await listTables(db)).not.toContain('document_comments');

    await migrateDown(db, 8);
    expect(await listTables(db)).toContain('document_comments');
    expect(await listTables(db)).not.toContain('comments');

    await migrate(db);
    expect(await listTables(db)).toContain('comments');
    expect(await listTables(db)).not.toContain('document_comments');
  });

  it('regression: 0009 migrate down then up adds and removes last_verification', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    expect(await hasColumn(db, 'goals', 'last_verification')).toBe(true);

    await migrateDown(db, 9);
    expect(await hasColumn(db, 'goals', 'last_verification')).toBe(false);

    await migrate(db);
    expect(await hasColumn(db, 'goals', 'last_verification')).toBe(true);
  });

  // The 0008 tasks-rebuild drops and recreates `tasks`, which has INCOMING FK
  // references from edges, documents.linked_task_id, and
  // share_submissions.linked_task_id. The live board has a dense edge graph, so
  // the rebuild must survive references (this fails without foreign_keys OFF at
  // the connection level — deferred FK counters trip on the implicit delete).
  it('regression: 0008 rebuild survives tasks referenced by edges, docs, submissions', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await migrateDown(db, 10); // back to 0007 (pre-goals)

    const projectId = randomUUID();
    const now = Date.now();
    await db.$client.execute({
      sql: `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      args: [projectId, 'FK project', now, now],
    });
    const project = { id: projectId };
    const t1 = await insertLegacyTask(db, project.id, 'Task 1');
    const t2 = await insertLegacyTask(db, project.id, 'Task 2');
    await db.$client.execute({
      sql: `INSERT INTO edges (id, project_id, from_task_id, to_task_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      args: [randomUUID(), project.id, t1, t2, now],
    });
    await db.$client.execute({
      sql: `INSERT INTO documents (id, project_id, title, linked_task_id, created_at, updated_at)
         VALUES (?, ?, 'Doc', ?, ?, ?)`,
      args: [randomUUID(), project.id, t1, now, now],
    });
    await db.$client.execute({
      sql: `INSERT INTO share_submissions
           (id, project_id, hosted_share_id, participant_name, title, status, linked_task_id, created_at, pulled_at)
         VALUES (?, ?, 'hs', 'p', 'sub', 'accepted', ?, ?, ?)`,
      args: [randomUUID(), project.id, t2, now, now],
    });

    // up (rebuild), down, and up again must all succeed with references present.
    await expect(migrate(db)).resolves.not.toThrow();
    await expect(migrateDown(db, 9)).resolves.not.toThrow();
    await expect(migrate(db)).resolves.not.toThrow();

    const edge = (await db.$client.execute('SELECT from_task_id, to_task_id FROM edges')).rows[0];
    expect(edge).toBeDefined();
    expect(edge?.from_task_id).toBe(t1);
    expect(edge?.to_task_id).toBe(t2);
    const tasks = (await db.$client.execute('SELECT goal_id FROM tasks')).rows;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => typeof t.goal_id === 'string' && t.goal_id.length > 0)).toBe(true);
  });
});
