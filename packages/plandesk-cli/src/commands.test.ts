import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProject,
  createTask,
  exportProject,
  getProject,
  PLANDESK_EXPORT_VERSION,
} from '@plandesk/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, workspaceDbPath } from './args.js';
import { main } from './cli.js';
import { runInit } from './init.js';
import { openWorkspace } from './workspace.js';

function captureIo(run: () => number): { code: number; stdout: string; stderr: string } {
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
    code = run();
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

  function makeWorkspace(): string {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-cli-'));
    tempDirs.push(dataDir);
    runInit(dataDir);
    return dataDir;
  }

  it('exports a project to plandesk-export-v1 JSON', () => {
    const dataDir = makeWorkspace();
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'CLI Export Project' });
    createTask(db, { projectId: project.id, label: 'Task A' });

    const outPath = join(dataDir, 'export.json');
    const { code, stdout } = captureIo(() =>
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

  it('exits 1 when export project is unknown', () => {
    const dataDir = makeWorkspace();
    const outPath = join(dataDir, 'missing.json');
    const { code, stderr } = captureIo(() =>
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

  it('round-trips export then import via CLI', () => {
    const dataDir = makeWorkspace();
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'Round Trip' });
    createTask(db, { projectId: project.id, label: 'Alpha' });
    createTask(db, { projectId: project.id, label: 'Beta' });

    const outPath = join(dataDir, 'round-trip.json');
    const exportResult = captureIo(() =>
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

    const importResult = captureIo(() =>
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

  it('exits 1 when import file has unsupported version', () => {
    const dataDir = makeWorkspace();
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

    const { code, stderr } = captureIo(() =>
      main(['node', 'plandesk', 'import', '--in', inPath, '--data-dir', dataDir]),
    );

    expect(code).toBe(1);
    expect(stderr).toContain('Unsupported export version');
  });

  it('exits 1 when import file has invalid JSON', () => {
    const dataDir = makeWorkspace();
    const inPath = join(dataDir, 'bad-json.json');
    writeFileSync(inPath, '{not json');

    const { code, stderr } = captureIo(() =>
      main(['node', 'plandesk', 'import', '--in', inPath, '--data-dir', dataDir]),
    );

    expect(code).toBe(1);
    expect(stderr).toContain('invalid JSON');
  });

  it('reports healthy workspace via doctor', () => {
    const dataDir = makeWorkspace();
    const { db } = openWorkspace(dataDir);
    const project = createProject(db, { name: 'Doctor Project' });
    createTask(db, { projectId: project.id, label: 'Check' });

    const { code, stdout } = captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Plan Desk doctor — OK');
    expect(stdout).toContain('migrations: applied');
    expect(stdout).toContain('projects: 1');
    expect(stdout).toContain('tasks: 1');
  });

  it('exits 2 when database is corrupt', () => {
    const dataDir = makeWorkspace();
    writeFileSync(workspaceDbPath(dataDir), 'this is not a sqlite database');

    const { code, stderr } = captureIo(() =>
      main(['node', 'plandesk', 'doctor', '--data-dir', dataDir]),
    );

    expect(code).toBe(2);
    expect(stderr).toContain('plandesk doctor');
  });

  it('exits 2 on export when database is corrupt', () => {
    const dataDir = makeWorkspace();
    writeFileSync(workspaceDbPath(dataDir), 'corrupt-bytes');

    const { code, stderr } = captureIo(() =>
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

  it('token create still works', () => {
    const dataDir = makeWorkspace();
    const { code, stdout } = captureIo(() =>
      main(['node', 'plandesk', 'token', 'create', '--name', 'cli-test', '--data-dir', dataDir]),
    );

    expect(code).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(10);
  });
});
