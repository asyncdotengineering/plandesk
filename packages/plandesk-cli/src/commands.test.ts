import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, exportProject, getProject, PLANDESK_EXPORT_VERSION } from '@plandesk/db';
import { createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, workspaceDbPath } from './args.js';
import { main } from './cli.js';
import { CURATOR_TEMPLATES } from './curator-templates.js';
import { runFactoryInit } from './factory.js';
import { runInit } from './init.js';
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

// Isolate the machine-global port registry (~/.plandesk/ports.json) so tests
// that run `init` never share its tmp path with other test files — concurrent
// writers otherwise race on ports.json.tmp (one's rename consumes the other's).
let portRegistryStateDir: string | undefined;
beforeEach(() => {
  portRegistryStateDir = mkdtempSync(join(tmpdir(), 'plandesk-cmd-state-'));
  process.env.PLANDESK_STATE_DIR = portRegistryStateDir;
});
afterEach(() => {
  delete process.env.PLANDESK_STATE_DIR;
  if (portRegistryStateDir !== undefined) {
    rmSync(portRegistryStateDir, { recursive: true, force: true });
    portRegistryStateDir = undefined;
  }
});

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

  it('exports a project to plandesk-export-v1 JSON', async () => {
    const dataDir = await makeWorkspace();
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'CLI Export Project' });
    createTask(db, { projectId: project.id, label: 'Task A' });

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
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'Round Trip' });
    createTask(db, { projectId: project.id, label: 'Alpha' });
    createTask(db, { projectId: project.id, label: 'Beta' });

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
    expect(getProject(db, importedProjectId)?.name).toBe('Round Trip');

    const reExported = exportProject(db, importedProjectId);
    const original = exportProject(db, project.id);
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
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'Doctor Project' });
    createTask(db, { projectId: project.id, label: 'Check' });

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Plan Desk doctor — OK');
    expect(stdout).toContain('migrations: applied');
    expect(stdout).toContain('projects: 1');
    expect(stdout).toContain('tasks: 1');
  });

  it('reports missing curator artifacts via doctor --repo', async () => {
    const dataDir = await makeWorkspace();
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-repo-'));
    tempDirs.push(repoDir);

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir, '--repo', repoDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(`curator: 0/${String(CURATOR_TEMPLATES.length)} artifacts present`);
    expect(stdout).toContain('curator-missing:');
    expect(stdout).toContain('.agents/curator/triage.md');
  });

  it('reports all curator artifacts present via doctor --repo after factory init', async () => {
    const dataDir = await makeWorkspace();
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-doctor-repo-'));
    tempDirs.push(repoDir);
    runFactoryInit({ repoDir });

    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir, '--repo', repoDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(
      `curator: ${String(CURATOR_TEMPLATES.length)}/${String(CURATOR_TEMPLATES.length)} artifacts present`,
    );
    expect(stdout).not.toContain('curator-missing:');
  });

  it('exits 2 when database is corrupt', async () => {
    const dataDir = await makeWorkspace();
    writeFileSync(workspaceDbPath(dataDir), 'this is not a sqlite database');

    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(2);
    expect(stderr).toContain('plandesk doctor');
  });

  it('exits 2 on export when database is corrupt', async () => {
    const dataDir = await makeWorkspace();
    writeFileSync(workspaceDbPath(dataDir), 'corrupt-bytes');

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

  it('token create still works', async () => {
    const dataDir = await makeWorkspace();
    const { code, stdout } = await captureIo(() =>
      main(['node', 'plandesk', 'token', 'create', '--name', 'cli-test', '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(10);
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
    ).toEqual({ command: 'preview', paths: ['a.md', 'b.html'], port: 4000, host: undefined, open: false });
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
