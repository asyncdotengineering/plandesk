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
    migrateDown(db, 1);
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

    migrateDown(db, 1);
    expect(listTables(db)).not.toContain('goals');
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(false);

    migrate(db);
    expect(listTables(db)).toContain('goals');
    expect(hasColumn(db, 'tasks', 'goal_id')).toBe(true);

    const tasks = db.$client.prepare('SELECT goal_id FROM tasks WHERE project_id = ?').all(project.id) as Array<{
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
});
