import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { migrate, migrateDown, migrateDownAll } from './migrate.js';
import { seed, FIXTURE_PROJECT_ID } from './seed.js';
import { getProject } from './repositories/projects.js';
import { randomUUID } from 'node:crypto';
import { createProject } from './repositories/projects.js';
import { createTaskWithDefaultGoal as createTask } from './testing.js';

function insertLegacyTask(
  db: ReturnType<typeof createDb>,
  projectId: string,
  label: string,
): string {
  const id = randomUUID();
  const now = Date.now();
  db.$client
    .prepare(
      `INSERT INTO tasks (id, project_id, label, status, x, y, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 0, 0, ?, ?)`,
    )
    .run(id, projectId, label, now, now);
  return id;
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
  'mcp_tokens',
  'shares',
  'share_submissions',
  'sync_state',
  'sync_remotes',
  'files',
  'artifacts',
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

    expect(hasColumn(db, 'comments', 'anchor')).toBe(true);

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('artifacts');

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('files');

    migrateDown(db, 1);
    expect(hasColumn(db, 'comments', 'anchor')).toBe(false);
    expect(listTables(db)).toContain('comments');

    migrateDown(db, 1);
    expect(listTables(db)).toContain('document_comments');
    expect(listTables(db)).not.toContain('comments');

    migrateDown(db, 1);
    expect(hasColumn(db, 'goals', 'last_verification')).toBe(false);

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('goals');
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(false);

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('tags');
    expect(listTables(db)).not.toContain('task_tags');
    expect(listTables(db)).toContain('folders');

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('folders');
    expect(hasColumn(db, 'documents', 'folder_id')).toBe(false);

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
    expect(listTables(db)).toContain('folders');
    expect(hasColumn(db, 'documents', 'folder_id')).toBe(true);
    expect(listTables(db)).toContain('tags');
    expect(listTables(db)).toContain('task_tags');
    expect(listTables(db)).toContain('goals');
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(true);
    expect(hasColumn(db, 'goals', 'last_verification')).toBe(true);
    expect(listTables(db)).toContain('comments');
    expect(hasColumn(db, 'comments', 'anchor')).toBe(true);
    expect(listTables(db)).toContain('artifacts');
    expect(getProject(db, FIXTURE_PROJECT_ID)?.name).toBe('Fixture Project');

    migrateDownAll(db);
    expect(listTables(db)).not.toContain('projects');

    migrate(db);
    seed(db);
    expect(getProject(db, FIXTURE_PROJECT_ID)?.name).toBe('Fixture Project');
  });

  it('0008 backfill assigns a default goal to pre-existing tasks', () => {
    const db = createDb(':memory:');
    migrate(db);
    migrateDown(db, 6);
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(false);
    expect(listTables(db)).not.toContain('goals');

    const project = createProject(db, { name: 'Legacy project' });
    const legacyTaskId = insertLegacyTask(db, project.id, 'Legacy task');

    migrate(db);
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(true);
    expect(listTables(db)).toContain('goals');

    const taskRow = db.$client
      .prepare('SELECT goal_id FROM tasks WHERE id = ?')
      .get(legacyTaskId) as { goal_id: string };
    const goalRow = db.$client
      .prepare('SELECT objective, project_id FROM goals WHERE id = ?')
      .get(taskRow.goal_id) as { objective: string; project_id: string };

    expect(goalRow.objective).toBe('General');
    expect(goalRow.project_id).toBe(project.id);
  });

  it('regression: 0008 migrate down then up on database with tasks', () => {
    const db = createDb(':memory:');
    migrate(db);
    const project = createProject(db, { name: 'Down up project' });
    createTask(db, { projectId: project.id, label: 'Task A' });
    createTask(db, { projectId: project.id, label: 'Task B' });

    migrateDown(db, 6);
    expect(listTables(db)).not.toContain('goals');
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(false);

    migrate(db);
    expect(listTables(db)).toContain('goals');
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(true);

    const tasks = db.$client
      .prepare('SELECT goal_id FROM tasks WHERE project_id = ?')
      .all(project.id) as Array<{
      goal_id: string;
    }>;
    expect(tasks).toHaveLength(2);
    const goalIds = new Set(tasks.map((task) => task.goal_id));
    expect(goalIds.size).toBe(1);
    const goal = db.$client
      .prepare('SELECT objective FROM goals WHERE id = ?')
      .get([...goalIds][0]) as { objective: string };
    expect(goal.objective).toBe('General');
  });

  it('0010 backfill migrates document_comments to comments with project_id', () => {
    const db = createDb(':memory:');
    migrate(db);
    migrateDown(db, 4);
    expect(listTables(db)).toContain('document_comments');
    expect(listTables(db)).not.toContain('comments');

    const project = createProject(db, { name: 'Legacy comments' });
    const now = Date.now();
    const docId = randomUUID();
    const commentId = randomUUID();
    db.$client
      .prepare(
        `INSERT INTO documents (id, project_id, title, created_at, updated_at)
         VALUES (?, ?, 'Legacy doc', ?, ?)`,
      )
      .run(docId, project.id, now, now);
    db.$client
      .prepare(
        `INSERT INTO document_comments (id, document_id, passage, body, resolved, created_at)
         VALUES (?, ?, 'p1', 'Legacy note', 0, ?)`,
      )
      .run(commentId, docId, now);

    migrate(db);
    expect(listTables(db)).toContain('comments');
    expect(listTables(db)).not.toContain('document_comments');

    const row = db.$client
      .prepare(
        'SELECT id, project_id, target_type, target_id, passage, body, resolved FROM comments WHERE id = ?',
      )
      .get(commentId) as {
      id: string;
      project_id: string;
      target_type: string;
      target_id: string;
      passage: string;
      body: string;
      resolved: number;
    };
    expect(row.project_id).toBe(project.id);
    expect(row.target_type).toBe('document');
    expect(row.target_id).toBe(docId);
    expect(row.passage).toBe('p1');
    expect(row.body).toBe('Legacy note');
    expect(row.resolved).toBe(0);
  });

  it('regression: 0010 migrate down then up restores document_comments', () => {
    const db = createDb(':memory:');
    migrate(db);
    expect(listTables(db)).toContain('comments');
    expect(listTables(db)).not.toContain('document_comments');

    migrateDown(db, 4);
    expect(listTables(db)).toContain('document_comments');
    expect(listTables(db)).not.toContain('comments');

    migrate(db);
    expect(listTables(db)).toContain('comments');
    expect(listTables(db)).not.toContain('document_comments');
  });

  it('regression: 0009 migrate down then up adds and removes last_verification', () => {
    const db = createDb(':memory:');
    migrate(db);
    expect(hasColumn(db, 'goals', 'last_verification')).toBe(true);

    migrateDown(db, 5);
    expect(hasColumn(db, 'goals', 'last_verification')).toBe(false);

    migrate(db);
    expect(hasColumn(db, 'goals', 'last_verification')).toBe(true);
  });

  // The 0008 tasks-rebuild drops and recreates `tasks`, which has INCOMING FK
  // references from edges, documents.linked_task_id, and
  // share_submissions.linked_task_id. The live board has a dense edge graph, so
  // the rebuild must survive references (this fails without foreign_keys OFF at
  // the connection level — deferred FK counters trip on the implicit delete).
  it('regression: 0008 rebuild survives tasks referenced by edges, docs, submissions', () => {
    const db = createDb(':memory:');
    migrate(db);
    migrateDown(db, 6); // back to 0007 (pre-goals)

    const project = createProject(db, { name: 'FK project' });
    const now = Date.now();
    const t1 = insertLegacyTask(db, project.id, 'Task 1');
    const t2 = insertLegacyTask(db, project.id, 'Task 2');
    db.$client
      .prepare(
        `INSERT INTO edges (id, project_id, from_task_id, to_task_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), project.id, t1, t2, now);
    db.$client
      .prepare(
        `INSERT INTO documents (id, project_id, title, linked_task_id, created_at, updated_at)
         VALUES (?, ?, 'Doc', ?, ?, ?)`,
      )
      .run(randomUUID(), project.id, t1, now, now);
    db.$client
      .prepare(
        `INSERT INTO share_submissions
           (id, project_id, hosted_share_id, participant_name, title, status, linked_task_id, created_at, pulled_at)
         VALUES (?, ?, 'hs', 'p', 'sub', 'accepted', ?, ?, ?)`,
      )
      .run(randomUUID(), project.id, t2, now, now);

    // up (rebuild), down, and up again must all succeed with references present.
    expect(() => {
      migrate(db);
    }).not.toThrow();
    expect(() => {
      migrateDown(db, 6);
    }).not.toThrow();
    expect(() => {
      migrate(db);
    }).not.toThrow();

    const edge = db.$client.prepare('SELECT from_task_id, to_task_id FROM edges').get() as {
      from_task_id: string;
      to_task_id: string;
    };
    expect(edge.from_task_id).toBe(t1);
    expect(edge.to_task_id).toBe(t2);
    const tasks = db.$client.prepare('SELECT goal_id FROM tasks').all() as Array<{
      goal_id: string;
    }>;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => typeof t.goal_id === 'string' && t.goal_id.length > 0)).toBe(true);
  });
});
