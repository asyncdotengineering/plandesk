import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ORG_ID,
  createDb,
  listCommentsByProject,
  listDocuments,
  listProjects,
  listTasks,
} from '@plandesk/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from './args.js';
import { main } from './cli.js';
import { runInit } from './init.js';
import {
  formatLegacyUpgradeSummary,
  legacyBackupPath,
  resolveLegacySourcePath,
  runLegacyUpgrade,
  toIsoTimestamp,
} from './legacy-upgrade.js';
import { openWorkspace } from './workspace.js';

async function captureIo(
  run: () => Promise<number> | number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  let code = 1;
  try {
    code = await Promise.resolve(run());
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    code,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

/** Build a fixture OLD-schema board (pre-org, document_comments, no goals/tags/folders). */
async function createOldSchemaFixture(path: string): Promise<{
  projectId: string;
  taskId: string;
  documentId: string;
  commentId: string;
}> {
  const db = await createDb(path);
  const client = db.$client;

  await client.execute(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      canvas_layout TEXT
    )
  `);
  await client.execute(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      description TEXT,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      assignee TEXT,
      due_date INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status_line TEXT,
      parent_id TEXT,
      linked_task_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE document_comments (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      passage TEXT,
      body TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE edges (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      from_task_id TEXT NOT NULL,
      to_task_id TEXT NOT NULL,
      label TEXT,
      arrow_direction TEXT,
      style TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      label TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  const projectId = 'legacy-proj-001';
  const taskId = 'legacy-task-001';
  const documentId = 'legacy-doc-001';
  const commentId = 'legacy-comment-001';
  const now = 1_700_000_000_000;

  await client.execute({
    sql: `INSERT INTO projects (id, name, description, created_at, updated_at, canvas_layout)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [projectId, 'Legacy Upgrade Fixture', 'from old board', now, now, null],
  });
  await client.execute({
    sql: `INSERT INTO tasks (id, project_id, label, status, description, x, y, assignee, due_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [taskId, projectId, 'Migrate me', 'todo', 'task body', 10, 20, null, null, now, now],
  });
  await client.execute({
    sql: `INSERT INTO documents (id, project_id, title, body, status_line, parent_id, linked_task_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [documentId, projectId, 'Spec', '<p>Select this passage</p>', null, null, null, now, now],
  });
  await client.execute({
    sql: `INSERT INTO document_comments (id, document_id, passage, body, resolved, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [commentId, documentId, 'Select this passage', 'Fix intro', 0, now],
  });

  client.close();
  return { projectId, taskId, documentId, commentId };
}

describe('parseArgs legacy-upgrade', () => {
  it('parses legacy-upgrade with --from and --data-dir', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'legacy-upgrade',
        '--from',
        '/tmp/old.db',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'legacy-upgrade',
      from: '/tmp/old.db',
      dataDir: '/tmp/ws',
    });
  });

  it('parses legacy-upgrade with no flags', () => {
    expect(parseArgs(['node', 'plandesk', 'legacy-upgrade'])).toEqual({
      command: 'legacy-upgrade',
      from: undefined,
      dataDir: undefined,
    });
  });
});

describe('legacy-upgrade helpers', () => {
  it('normalizes integer-ms timestamps to ISO', () => {
    expect(toIsoTimestamp(1_700_000_000_000)).toBe(new Date(1_700_000_000_000).toISOString());
    expect(toIsoTimestamp('1700000000000')).toBe(new Date(1_700_000_000_000).toISOString());
    expect(toIsoTimestamp('2024-01-15T12:00:00.000Z')).toBe('2024-01-15T12:00:00.000Z');
  });

  it('resolves --from explicitly', () => {
    expect(resolveLegacySourcePath('/explicit/path.db')).toBe('/explicit/path.db');
  });
});

describe('CLI legacy-upgrade', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it('auto-inits the global board when it does not exist yet (single-command upgrade)', async () => {
    const root = tempDir('plandesk-legacy-autoinit-');
    const oldPath = join(root, 'old-workspace.db');
    const dataDir = join(root, 'global'); // deliberately NOT init'd first
    await createOldSchemaFixture(oldPath);

    const { code, stdout, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'legacy-upgrade', '--from', oldPath, '--data-dir', dataDir]),
    );

    // Before auto-init this errored "Run `plandesk init` first"; now it creates + imports.
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Imported 1 projects, 1 tasks, 1 documents');

    const { db } = await openWorkspace(dataDir);
    const projects = await listProjects(db, DEFAULT_ORG_ID);
    expect(projects).toHaveLength(1);
  });

  it('imports project+tasks+document+comment into the global board under DEFAULT_ORG_ID', async () => {
    const root = tempDir('plandesk-legacy-up-');
    const oldPath = join(root, 'old-workspace.db');
    const dataDir = join(root, 'global');
    await createOldSchemaFixture(oldPath);
    await runInit(dataDir);

    const { code, stdout, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'legacy-upgrade',
        '--from',
        oldPath,
        '--data-dir',
        dataDir,
      ]),
    );

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Imported 1 projects, 1 tasks, 1 documents');
    expect(stdout).toContain(`org ${DEFAULT_ORG_ID}`);
    expect(stdout).toContain('Skipped: 0 already present');
    expect(stdout).toContain(legacyBackupPath(oldPath));
    expect(stdout).toContain('Regenerate a CLI token');
    expect(existsSync(legacyBackupPath(oldPath))).toBe(true);

    const { db } = await openWorkspace(dataDir);
    const projects = await listProjects(db, DEFAULT_ORG_ID);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.orgId).toBe(DEFAULT_ORG_ID);
    expect(projects[0]?.name).toBe('Legacy Upgrade Fixture');

    const projectId = projects[0]!.id;
    const tasks = await listTasks(db, projectId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.label).toBe('Migrate me');

    const documents = await listDocuments(db, projectId);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.title).toBe('Spec');

    const comments = await listCommentsByProject(db, projectId, { includeResolved: true });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.targetType).toBe('document');
    expect(comments[0]?.targetId).toBe(documents[0]!.id);
    expect(comments[0]?.body).toBe('Fix intro');
    expect(comments[0]?.passage).toBe('Select this passage');
    expect(comments[0]?.resolved).toBe(false);

    // Old board is never mutated (read-only): still has the original project id.
    const oldDb = await createDb(oldPath);
    const oldProjects = await oldDb.$client.execute('SELECT id, name FROM projects');
    expect(oldProjects.rows).toHaveLength(1);
    expect(oldProjects.rows[0]?.['id']).toBe('legacy-proj-001');
    oldDb.$client.close();
  });

  it('re-run skips already-present projects with no duplicates', async () => {
    const root = tempDir('plandesk-legacy-rerun-');
    const oldPath = join(root, 'old-workspace.db');
    const dataDir = join(root, 'global');
    await createOldSchemaFixture(oldPath);
    await runInit(dataDir);

    const first = await captureIo(() =>
      main(['node', 'plandesk', 'legacy-upgrade', '--from', oldPath, '--data-dir', dataDir]),
    );
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('Imported 1 projects');

    const second = await captureIo(() =>
      main(['node', 'plandesk', 'legacy-upgrade', '--from', oldPath, '--data-dir', dataDir]),
    );
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('Imported 0 projects');
    expect(second.stdout).toContain('Skipped: 1 already present');

    const { db } = await openWorkspace(dataDir);
    expect(await listProjects(db, DEFAULT_ORG_ID)).toHaveLength(1);
  });

  it('already-new-schema source is a no-op exit 0', async () => {
    const root = tempDir('plandesk-legacy-noop-');
    const dataDir = join(root, 'global');
    await runInit(dataDir);
    const newBoardPath = join(dataDir, 'workspace.db');
    const copyPath = join(root, 'already-new.db');
    copyFileSync(newBoardPath, copyPath);

    const targetDir = join(root, 'target');
    await runInit(targetDir);

    const result = await runLegacyUpgrade({ from: copyPath, dataDir: targetDir });
    expect(result.kind).toBe('noop');
    if (result.kind === 'noop') {
      expect(result.reason).toBe('already_new_schema');
    }
    expect(formatLegacyUpgradeSummary(result)).toContain('already upgraded / new schema');

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'legacy-upgrade', '--from', copyPath, '--data-dir', targetDir]),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('already upgraded / new schema, nothing to do');

    const { db } = await openWorkspace(targetDir);
    expect(await listProjects(db, DEFAULT_ORG_ID)).toHaveLength(0);
  });

  it('exits 1 when --from path is missing', async () => {
    const root = tempDir('plandesk-legacy-missing-');
    const dataDir = join(root, 'global');
    await runInit(dataDir);

    const { code, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'legacy-upgrade',
        '--from',
        join(root, 'does-not-exist.db'),
        '--data-dir',
        dataDir,
      ]),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('Legacy board not found');
  });
});
