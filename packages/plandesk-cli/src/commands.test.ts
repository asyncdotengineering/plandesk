import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  exportProject,
  getProject,
  PLANDESK_EXPORT_VERSION,
} from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, workspaceDbPath } from './args.js';
import { main } from './cli.js';
import { buildConfigJson } from './connect-artifacts.js';
import { SHIPPED_TEMPLATES } from './shipped-templates.js';
import { SERVER_CONFIG_FILENAME } from './config.js';
import { readStringCell } from './database-schema.js';
import { runFactoryInit } from './factory.js';
import { runInit } from './init.js';
import { startServer } from './serve.js';
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

describe('parseArgs export/import/doctor', () => {
  it('parses export with project, out, and data-dir', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'export',
        '--project',
        'proj-1',
        '--out',
        '/tmp/out.json',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'export',
      projectId: 'proj-1',
      outPath: '/tmp/out.json',
      dataDir: '/tmp/ws',
    });
  });

  it('parses import with in and data-dir', () => {
    expect(
      parseArgs(['node', 'plandesk', 'import', '--in', '/tmp/in.json', '--data-dir', '/tmp/ws']),
    ).toEqual({
      command: 'import',
      inPath: '/tmp/in.json',
      dataDir: '/tmp/ws',
    });
  });

  it('parses doctor with data-dir', () => {
    expect(parseArgs(['node', 'plandesk', 'doctor', '--data-dir', '/tmp/ws'])).toEqual({
      command: 'doctor',
      dataDir: '/tmp/ws',
    });
  });

  it('returns unknown when export is missing --project', () => {
    expect(parseArgs(['node', 'plandesk', 'export', '--out', '/tmp/out.json'])).toEqual({
      command: 'unknown',
      name: 'export (missing --project)',
    });
  });

  it('returns unknown when import is missing --in', () => {
    expect(parseArgs(['node', 'plandesk', 'import'])).toEqual({
      command: 'unknown',
      name: 'import (missing --in)',
    });
  });

  it('parses context with repo', () => {
    expect(parseArgs(['node', 'plandesk', 'context', '--json', '--repo', '/tmp/repo'])).toEqual({
      command: 'context',
      repoDir: '/tmp/repo',
    });
  });

  it('parses progress-checkpoint with message and repo', () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'progress-checkpoint',
        '--message',
        'custom checkpoint',
        '--repo',
        '/tmp/repo',
      ]),
    ).toEqual({
      command: 'progress-checkpoint',
      message: 'custom checkpoint',
      repoDir: '/tmp/repo',
    });
  });

  it('parses progress-checkpoint with no flags', () => {
    expect(parseArgs(['node', 'plandesk', 'progress-checkpoint'])).toEqual({
      command: 'progress-checkpoint',
      message: undefined,
      repoDir: undefined,
    });
  });
});

describe('CLI export/import/doctor', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  async function makeWorkspace(): Promise<string> {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-cli-'));
    tempDirs.push(dataDir);
    await runInit(dataDir);
    return dataDir;
  }

  /** WAL sidecars can satisfy reads after the main file is overwritten — remove them too. */
  function corruptWorkspaceDatabase(dataDir: string, payload = 'corrupt-bytes'): void {
    const dbPath = workspaceDbPath(dataDir);
    writeFileSync(dbPath, payload);
    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(sidecar)) {
        rmSync(sidecar);
      }
    }
  }

  it('exports a project to plandesk-export-v1 JSON', async () => {
    const dataDir = await makeWorkspace();
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'CLI Export Project' });
    await createTask(db, { projectId: project.id, label: 'Task A' });

    const outPath = join(dataDir, 'export.json');
    const { code, stdout } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'export',
        '--project',
        project.id,
        '--out',
        outPath,
        '--data-dir',
        dataDir,
      ]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(`Exported project ${project.id}`);
    const exported = JSON.parse(readFileSync(outPath, 'utf8')) as { version: string };
    expect(exported.version).toBe(PLANDESK_EXPORT_VERSION);
  });

  it('exits 1 when export project is unknown', async () => {
    const dataDir = await makeWorkspace();
    const outPath = join(dataDir, 'missing.json');
    const { code, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'export',
        '--project',
        '00000000-0000-4000-8000-000000009999',
        '--out',
        outPath,
        '--data-dir',
        dataDir,
      ]),
    );

    expect(code).toBe(1);
    expect(stderr).toContain('project not found');
  });

  it('round-trips export then import via CLI', async () => {
    const dataDir = await makeWorkspace();
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'Round Trip' });
    await createTask(db, { projectId: project.id, label: 'Alpha' });
    await createTask(db, { projectId: project.id, label: 'Beta' });

    const outPath = join(dataDir, 'round-trip.json');
    const exportResult = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'export',
        '--project',
        project.id,
        '--out',
        outPath,
        '--data-dir',
        dataDir,
      ]),
    );
    expect(exportResult.code).toBe(0);

    const importResult = await captureIo(() =>
      main(['node', 'plandesk', 'import', '--in', outPath, '--data-dir', dataDir]),
    );
    expect(importResult.code).toBe(0);

    const importedProjectId = importResult.stdout.trim();
    expect(importedProjectId).not.toBe(project.id);
    expect((await getProject(db, importedProjectId))?.name).toBe('Round Trip');

    const reExported = await exportProject(db, importedProjectId);
    const original = await exportProject(db, project.id);
    expect(reExported?.project).toEqual(original?.project);
    expect(reExported?.tasks.map((task) => task.label).sort()).toEqual(
      original?.tasks.map((task) => task.label).sort(),
    );
  });

  it('exits 1 when import file has unsupported version', async () => {
    const dataDir = await makeWorkspace();
    const inPath = join(dataDir, 'bad-version.json');
    writeFileSync(
      inPath,
      JSON.stringify({
        version: 'plandesk-export-v0',
        project: { name: 'X', description: null, canvas_layout: null },
        tasks: [],
        edges: [],
        documents: [],
        agent_runs: [],
      }),
    );

    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'import', '--in', inPath, '--data-dir', dataDir]),
    );

    expect(code).toBe(1);
    expect(stderr).toContain('Unsupported export version');
  });

  it('exits 1 when import file has invalid JSON', async () => {
    const dataDir = await makeWorkspace();
    const inPath = join(dataDir, 'bad-json.json');
    writeFileSync(inPath, '{not json');

    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'import', '--in', inPath, '--data-dir', dataDir]),
    );

    expect(code).toBe(1);
    expect(stderr).toContain('invalid JSON');
  });

  it('reports healthy workspace via doctor', async () => {
    const dataDir = await makeWorkspace();
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'Doctor Project' });
    await createTask(db, { projectId: project.id, label: 'Check' });

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(`board: ${dataDir} (flag)`);
    expect(stdout).toContain('Plan Desk doctor — OK');
    expect(stdout).toContain('migrations: applied');
    expect(stdout).toContain('projects: 1');
    expect(stdout).toContain('tasks: 1');
    expect(stdout).toContain('board: 1 project(s) on this board; last export: never');
    expect(stdout).toContain('plandesk export');
    expect(stdout).toContain('plandesk push --to');
  });

  it('doctor reports last export timestamp after an export', async () => {
    const dataDir = await makeWorkspace();
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'Export Mark' });
    const outPath = join(dataDir, 'mark.json');

    const exportResult = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'export',
        '--project',
        project.id,
        '--out',
        outPath,
        '--data-dir',
        dataDir,
      ]),
    );
    expect(exportResult.code).toBe(0);

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );
    expect(code).toBe(0);
    expect(stdout).toMatch(/last export: \d{4}-\d{2}-\d{2}T/);
    expect(stdout).not.toContain('last export: never');
  });

  it('reports missing scaffold artifacts via doctor --repo', async () => {
    const dataDir = await makeWorkspace();
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-repo-'));
    tempDirs.push(repoDir);

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir, '--repo', repoDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(`skills + hooks: 0/${String(SHIPPED_TEMPLATES.length)} present`);
    expect(stdout).toContain('skills + hooks missing:');
    expect(stdout).toContain('.agents/skills/plandesk-scope-work/SKILL.md');
  });

  it('reports all scaffold artifacts present via doctor --repo after factory init', async () => {
    const dataDir = await makeWorkspace();
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-repo-'));
    tempDirs.push(repoDir);
    runFactoryInit({ repoDir });

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir, '--repo', repoDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(
      `skills + hooks: ${String(SHIPPED_TEMPLATES.length)}/${String(SHIPPED_TEMPLATES.length)} present`,
    );
    expect(stdout).not.toContain('skills + hooks missing:');
  });

  it('warns on board divergence when the bound server serves a different board than doctor resolved (#34, A5)', async () => {
    const doctorsDataDir = await makeWorkspace();
    const servedDataDir = await makeWorkspace();
    const { db } = await openWorkspace(servedDataDir);
    const project = await createProject(db, { name: 'Served Project' });

    const server = await startServer({ port: 0, dataDir: servedDataDir });
    try {
      if (!server.listening) {
        await new Promise<void>((resolve) => server.once('listening', resolve));
      }
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-divergence-'));
      tempDirs.push(repoDir);
      mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
      writeFileSync(
        join(repoDir, '.plandesk', 'config.json'),
        buildConfigJson({
          serverUrl: `http://127.0.0.1:${String(port)}`,
          projectId: project.id,
          projectName: project.name,
        }),
        'utf8',
      );

      const { code, stdout } = await captureIo(() =>
        main(['node', 'plandesk', 'doctor', '--data-dir', doctorsDataDir, '--repo', repoDir]),
      );

      // A genuine board divergence is a real problem — doctor reports it unhealthy (exit 1),
      // same as any other binding issue.
      expect(code).toBe(1);
      expect(stdout).toContain('board-divergence:');
      expect(stdout).toContain(doctorsDataDir);
      expect(stdout).toContain(servedDataDir);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  it('reports no board divergence when the bound server serves the same board doctor resolved', async () => {
    const dataDir = await makeWorkspace();
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'Same Board Project' });

    const server = await startServer({ port: 0, dataDir });
    try {
      if (!server.listening) {
        await new Promise<void>((resolve) => server.once('listening', resolve));
      }
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-nodivergence-'));
      tempDirs.push(repoDir);
      mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
      writeFileSync(
        join(repoDir, '.plandesk', 'config.json'),
        buildConfigJson({
          serverUrl: `http://127.0.0.1:${String(port)}`,
          projectId: project.id,
          projectName: project.name,
        }),
        'utf8',
      );

      const { code, stdout } = await captureIo(() =>
        main(['node', 'plandesk', 'doctor', '--data-dir', dataDir, '--repo', repoDir]),
      );

      expect(code).toBe(0);
      expect(stdout).not.toContain('board-divergence:');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  it('exits 2 when database is corrupt', async () => {
    const dataDir = await makeWorkspace();
    corruptWorkspaceDatabase(dataDir, 'this is not a sqlite database');

    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(2);
    expect(stderr).toContain('plandesk doctor');
  });

  it('exits 2 on export when database is corrupt', async () => {
    const dataDir = await makeWorkspace();
    corruptWorkspaceDatabase(dataDir);

    const { code, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'export',
        '--project',
        '00000000-0000-4000-8000-000000000001',
        '--out',
        join(dataDir, 'out.json'),
        '--data-dir',
        dataDir,
      ]),
    );

    expect(code).toBe(2);
    expect(stderr).toContain('plandesk doctor');
  });

  it('doctor redacts secret config values and never prints them (REQ-4)', async () => {
    const dataDir = await makeWorkspace();
    const secretPassword = 'super-secret-password-XYZ';
    const secretToken = 'super-secret-db-token-ABC';
    process.env.PLANDESK_AUTH_PASSWORD = secretPassword;
    process.env.PLANDESK_DB_TOKEN = secretToken;
    try {
      const { code, stdout } = await captureIo(() =>
        main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
      );
      expect(code).toBe(0);
      // The secret values must never appear anywhere in the output.
      expect(stdout).not.toContain(secretPassword);
      expect(stdout).not.toContain(secretToken);
      // But their presence + source is reported, redacted.
      expect(stdout).toContain('auth-password: <redacted> (env)');
      expect(stdout).toContain('db-token: <redacted> (env)');
      // Non-secret keys print their value + source.
      expect(stdout).toContain('host: 127.0.0.1 (default)');
      expect(stdout).toContain('storage: local (default)');
    } finally {
      delete process.env.PLANDESK_AUTH_PASSWORD;
      delete process.env.PLANDESK_DB_TOKEN;
    }
  });

  it('doctor probes a remote schema instead of assuming migrations are applied', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-remote-'));
    const remoteDb = join(dataDir, 'remote.db');
    tempDirs.push(dataDir);
    writeFileSync(
      join(dataDir, SERVER_CONFIG_FILENAME),
      JSON.stringify({ dbUrl: remoteDb }),
      'utf8',
    );

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(1);
    expect(stdout).toContain('Plan Desk doctor — FAIL');
    expect(stdout).toContain('migrations: missing');
    expect(stdout).toContain('missing:');
    expect(stdout).toContain('organization');
  });

  it('migrate applies schema to a database url (operator self-host path, REQ-8)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'plandesk-migrate-'));
    tempDirs.push(tmp);
    const dbFile = join(tmp, 'migrated.db');
    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'migrate', '--db', dbFile]),
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Applied migrations');

    const db = await createDb(dbFile);
    const result = await db.$client.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const names = result.rows.map((row) => readStringCell(row.name, 'sqlite_master.name'));
    expect(names).toContain('projects');
    expect(names).toContain('__drizzle_migrations');
  });

  it('migrate --db also creates the Better Auth identity tables (REQ-6, REQ-23)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'plandesk-migrate-auth-'));
    tempDirs.push(tmp);
    const dbFile = join(tmp, 'migrated.db');
    const { code } = await captureIo(() => main(['node', 'plandesk', 'migrate', '--db', dbFile]));
    expect(code).toBe(0);

    const db = await createDb(dbFile);
    const result = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization', 'user', 'account')",
    );
    expect(new Set(result.rows.map((row) => row.name))).toEqual(
      new Set(['account', 'organization', 'user']),
    );
    db.$client.close();
  });

  it('migrate exits 1 with a clear message when no database url is configured', async () => {
    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'migrate', '--data-dir', '/no/such/dir']),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('No database URL configured');
  });
});

describe('CLI context/progress-checkpoint no-binding smoke test', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function makeUnboundRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-unbound-'));
    tempDirs.push(repoDir);
    return repoDir;
  }

  it('context exits 0 and prints {} when the repo has no .plandesk/config.json', async () => {
    const repoDir = makeUnboundRepo();
    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'context', '--json', '--repo', repoDir]),
    );

    expect(code).toBe(0);
    expect(stdout.trim()).toBe('{}');
  });

  it('progress-checkpoint exits 0 and no-ops when the repo has no .plandesk/config.json', async () => {
    const repoDir = makeUnboundRepo();
    const { code } = await captureIo(() =>
      main(['node', 'plandesk', 'progress-checkpoint', '--repo', repoDir]),
    );

    expect(code).toBe(0);
  });
});

describe('preview command dispatch', () => {
  it('parses the explicit open subcommand with paths and flags', () => {
    expect(
      parseArgs(['node', 'plandesk', 'open', 'a.md', 'b.html', '--port', '4000', '--no-open']),
    ).toEqual({
      command: 'preview',
      paths: ['a.md', 'b.html'],
      port: 4000,
      host: undefined,
      open: false,
    });
  });

  it('treats preview and annotate as aliases of open', () => {
    expect(parseArgs(['node', 'plandesk', 'preview', 'x.md'])).toMatchObject({
      command: 'preview',
      paths: ['x.md'],
      open: true,
    });
    expect(parseArgs(['node', 'plandesk', 'annotate', 'y.markdown'])).toMatchObject({
      command: 'preview',
      paths: ['y.markdown'],
    });
  });

  it('routes a bare existing previewable file to preview (plandesk *.md)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-preview-'));
    try {
      const md = join(dir, 'report.md');
      const html = join(dir, 'page.html');
      writeFileSync(md, '# Hi');
      writeFileSync(html, '<h1>Hi</h1>');
      // Simulates the shell expanding `plandesk *.md *.html`.
      expect(parseArgs(['node', 'plandesk', md, html])).toMatchObject({
        command: 'preview',
        paths: [md, html],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not route a non-existent .md arg to preview (guards against shadowing)', () => {
    expect(parseArgs(['node', 'plandesk', 'does-not-exist.md'])).toEqual({
      command: 'unknown',
      name: 'does-not-exist.md',
    });
  });

  it('never lets a file shadow a reserved subcommand', () => {
    // `serve` is reserved even if a file named `serve` existed in cwd.
    expect(parseArgs(['node', 'plandesk', 'serve'])).toMatchObject({ command: 'serve' });
  });
});
