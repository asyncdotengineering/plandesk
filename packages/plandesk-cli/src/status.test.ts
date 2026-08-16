import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from './args.js';
import { main } from './cli.js';
import { writeServerInfo } from './connect-artifacts.js';
import { runInit } from './init.js';
import { formatStatusReport, runStatus } from './status.js';
import { openWorkspace } from './workspace.js';

describe('parseArgs status/ps', () => {
  it('parses status as a command', () => {
    expect(parseArgs(['node', 'plandesk', 'status'])).toEqual({ command: 'status' });
  });

  it('parses ps as an alias of status', () => {
    expect(parseArgs(['node', 'plandesk', 'ps'])).toEqual({ command: 'status' });
  });
});

describe('runStatus', () => {
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

  it('lists a board with a live PID as running, with correct project count (REQ-A4a)', async () => {
    const dataDir = tempDir('plandesk-status-live-');
    await runInit(dataDir);
    const { db } = await openWorkspace(dataDir);
    await createProject(db, { name: 'Alpha' });
    writeServerInfo(dataDir, {
      port: 5001,
      pid: process.pid,
      host: '127.0.0.1',
      startedAt: '2026-01-01T00:00:00.000Z',
      dataDir,
    });

    const boards = await runStatus({ startDir: dataDir, defaultDir: dataDir });
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({
      dataDir,
      running: true,
      pid: process.pid,
      port: 5001,
      projectCount: 1,
    });
  });

  it('lists a board with a dead PID as not running (stale server.json)', async () => {
    const dataDir = tempDir('plandesk-status-dead-');
    await runInit(dataDir);
    writeServerInfo(dataDir, {
      port: 5002,
      pid: 999999999,
      host: '127.0.0.1',
      startedAt: '2026-01-01T00:00:00.000Z',
      dataDir,
    });

    const boards = await runStatus({ startDir: dataDir, defaultDir: dataDir });
    expect(boards).toHaveLength(1);
    expect(boards[0]?.running).toBe(false);
    expect(boards[0]?.pid).toBeUndefined();
    expect(boards[0]?.projectCount).toBe(0);
  });

  it('lists a board with no server.json as not running', async () => {
    const dataDir = tempDir('plandesk-status-none-');
    await runInit(dataDir);

    const boards = await runStatus({ startDir: dataDir, defaultDir: dataDir });
    expect(boards).toHaveLength(1);
    expect(boards[0]?.running).toBe(false);
    expect(boards[0]?.port).toBeUndefined();
  });

  it('does not list an uninitialized board (no workspace.db)', async () => {
    const dataDir = tempDir('plandesk-status-uninit-');
    const boards = await runStatus({ startDir: dataDir, defaultDir: dataDir });
    expect(boards).toHaveLength(0);
  });

  it('enumerates the repo-local shadow board separately from the global default', async () => {
    const globalDir = tempDir('plandesk-status-global-');
    const repoDir = tempDir('plandesk-status-repo-');
    await runInit(globalDir);
    await runInit(join(repoDir, '.plandesk'));

    const boards = await runStatus({ startDir: repoDir, defaultDir: globalDir });
    const dataDirs = boards.map((b) => b.dataDir).sort();
    expect(dataDirs).toEqual([globalDir, join(repoDir, '.plandesk')].sort());
  });

  it('formatStatusReport renders a readable table with board/port/pid/projects columns', () => {
    const report = formatStatusReport([
      {
        dataDir: '/tmp/board-a',
        source: 'default',
        running: true,
        pid: 123,
        port: 7526,
        projectCount: 3,
      },
      { dataDir: '/tmp/board-b', source: 'shadow', running: false, port: 8080, projectCount: 0 },
    ]);
    expect(report).toContain('/tmp/board-a');
    expect(report).toContain('7526');
    expect(report).toContain('123');
    expect(report).toContain('/tmp/board-b');
    expect(report).toContain('8080');
    expect(report).toContain('-');
  });

  it('formatStatusReport handles the empty case', () => {
    expect(formatStatusReport([])).toContain('No Plan Desk boards found');
  });
});

describe('CLI status/ps', () => {
  it('`plandesk status` lists a repo-local shadow board with correct running state (REQ-A4a)', async () => {
    const cwd = process.cwd();
    const tmpRepo = mkdtempSync(join(tmpdir(), 'plandesk-status-cli-'));
    try {
      process.chdir(tmpRepo);
      // macOS may resolve /tmp → /private/tmp after chdir; use real cwd.
      const repoCwd = process.cwd();
      const shadowDir = join(repoCwd, '.plandesk');
      await runInit(shadowDir);
      writeServerInfo(shadowDir, {
        port: 5003,
        pid: process.pid,
        host: '127.0.0.1',
        startedAt: '2026-01-01T00:00:00.000Z',
        dataDir: shadowDir,
      });

      const stdoutChunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          stdoutChunks.push(String(chunk));
          return true;
        });
      let code = 1;
      try {
        code = await main(['node', 'plandesk', 'status']);
      } finally {
        stdoutSpy.mockRestore();
      }
      expect(code).toBe(0);
      const output = stdoutChunks.join('');
      expect(output).toContain(shadowDir);
      expect(output).toContain('5003');
      expect(output).toContain(String(process.pid));
    } finally {
      process.chdir(cwd);
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});
