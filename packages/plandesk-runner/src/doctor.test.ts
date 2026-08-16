import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_KEY_ENV, CONFIG_PATH_ENV } from './config.js';
import { formatDoctorReport, runDoctor } from './doctor.js';
import type { DoctorReport } from './doctor.js';

const tempDirs: string[] = [];
let server: Server | undefined;

beforeEach(() => {
  vi.stubEnv(AGENT_KEY_ENV, '');
  vi.stubEnv(CONFIG_PATH_ENV, '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
    server = undefined;
  });
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
}

/**
 * A fully hermetic doctor fixture. `workersDir` and `workdir` must be temp
 * paths: without them runDoctor resolves this repository's real
 * `.agents/factory/workers` and shells out to every worker's probe, which turns
 * a unit test into a multi-second subprocess run that times out under load.
 */
function makeAuthFixture(text: string): { configPath: string; workersDir: string } {
  const dir = makeTempDir('plandesk-runner-doctor-auth-');
  const workersDir = join(dir, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  const configPath = join(dir, 'runner.toml');
  writeFileSync(configPath, `${text}workdir = "${join(dir, 'work')}"\n`);
  return { configPath, workersDir };
}

function makeFixture(boardUrl: string): { configPath: string; workersDir: string } {
  const dir = makeTempDir('plandesk-runner-doctor-');
  const configPath = join(dir, 'runner.toml');
  writeFileSync(
    configPath,
    `board_url = "${boardUrl}"\nagent_key = "sk-doctor-key-abcdefgh"\nworkdir = "${join(dir, 'work')}"\n`,
  );
  const workersDir = join(dir, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  writeFileSync(join(workersDir, 'pi.md'), '---\ntype: worker\n---\n');
  writeFileSync(join(workersDir, 'codex.md'), '---\ntype: worker\n---\n');
  return { configPath, workersDir };
}

/** A fixture whose workers carry full headless declarations, so resolution runs. */
function makeFullFixture(
  boardUrl: string,
  configWorkers: string[] = [],
): { configPath: string; workersDir: string } {
  const dir = makeTempDir('plandesk-runner-doctor-');
  const workersLine = configWorkers.length > 0 ? `\nworkers = [${configWorkers.map((w) => `"${w}"`).join(', ')}]\n` : '\n';
  const configPath = join(dir, 'runner.toml');
  writeFileSync(
    configPath,
    `board_url = "${boardUrl}"\nagent_key = "sk-doctor-key-abcdefgh"${workersLine}workdir = "${join(dir, 'work')}"\n`,
  );
  const workersDir = join(dir, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  writeFileSync(
    join(workersDir, 'pi.md'),
    '---\ntype: worker\nprobe: "true"\nversion: echo pi-9.9\nheadless: pi --print {prompt_file}\n---\n',
  );
  writeFileSync(
    join(workersDir, 'codex.md'),
    '---\ntype: worker\nprobe: "true"\nheadless: codex exec {prompt_file} -o {result_file}\n---\n',
  );
  // Declared but never headless-capable: stays valid interactively, excluded here.
  writeFileSync(
    join(workersDir, 'cursor.md'),
    '---\ntype: worker\nprobe: "true"\ncommand: cursor-agent -p {prompt_file}\n---\n',
  );
  return { configPath, workersDir };
}

async function startLocalBoard(): Promise<string> {
  server = createServer((_request, response) => {
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    if (server === undefined) {
      reject(new Error('server missing'));
      return;
    }
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

describe('runDoctor', () => {
  it('runs against a fixture config without throwing and reports every worker row', async () => {
    const boardUrl = await startLocalBoard();
    const { configPath, workersDir } = makeFixture(boardUrl);

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });

    expect(report.board.reachable).toBe(true);
    expect(report.board.status).toBe(204);
    expect(report.workers.map((worker) => worker.id)).toEqual(['codex', 'pi']);
    // The report config is redacted — no trace of the real key.
    expect(JSON.stringify(report.config)).not.toContain('sk-doctor-key-abcdefgh');
    expect(report.config.agentKey).toBe('<redacted:22>');
  });

  it('reports an unreachable board instead of throwing', async () => {
    // Port 1 on loopback: connection refused immediately, no slow timeout.
    const { configPath, workersDir } = makeFixture('http://127.0.0.1:1');

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });

    expect(report.board.reachable).toBe(false);
    expect(report.board.error).toBeDefined();
  });

  it('tolerates a repo with no workers directory', async () => {
    const boardUrl = await startLocalBoard();
    const dir = makeTempDir('plandesk-runner-noworkers-');
    const configPath = join(dir, 'runner.toml');
    writeFileSync(
      configPath,
      `board_url = "${boardUrl}"\nagent_key = "sk-doctor-key-abcdefgh"\nworkdir = "${join(dir, 'work')}"\n`,
    );

    const report = await runDoctor({ configPath, cwd: dir, timeoutMs: 2000 });

    expect(report.workersDir).toBeUndefined();
    expect(report.workers).toEqual([]);
    expect(report.resolution).toBeUndefined();
    expect(formatDoctorReport(report)).toContain('no .agents/factory/workers directory found');
  });

  it('reports probe failures without throwing and shows the resulting usable set', async () => {
    const boardUrl = await startLocalBoard();
    const { configPath, workersDir } = makeFullFixture(boardUrl);
    // Overwrite codex's probe so it fails loudly while pi stays ready.
    writeFileSync(
      join(workersDir, 'codex.md'),
      '---\ntype: worker\nprobe: echo doctor-boom >&2; exit 4\nheadless: codex exec {prompt_file}\n---\n',
    );

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });

    expect(report.resolution?.usable.map((worker) => worker.name)).toEqual(['pi']);
    expect(report.resolution?.excluded.map((exclusion) => exclusion.worker)).toEqual([
      'codex',
      'cursor',
    ]);
    expect(report.resolution?.excluded[0]?.reason).toBe('probe-failed');
    if (report.resolution?.excluded[0]?.reason === 'probe-failed') {
      expect(report.resolution.excluded[0].stderr).toContain('doctor-boom');
    }
    expect(report.resolution?.excluded[1]).toEqual({ worker: 'cursor', reason: 'no-headless-key' });
  });

  it('reports the orphan set without settling anything', async () => {
    const boardUrl = await startLocalBoard();
    const { configPath, workersDir } = makeFixture(boardUrl);
    const orphanDir = join(dirname(configPath), 'work', 'worktrees', 'task-1');
    mkdirSync(orphanDir, { recursive: true });

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });

    expect(report.orphanScanError).toBeUndefined();
    expect(report.orphans).toEqual([{ taskId: 'task-1', worktreeDir: orphanDir }]);
    const text = formatDoctorReport(report);
    expect(text).toContain('orphans (1)');
    expect(text).toContain('nothing settled');
    expect(text).toContain('task-1');
    // Doctor never held a board credential beyond the unauthenticated ping —
    // structurally incapable of settling anything.
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('does not throw when the usable set ends up empty', async () => {
    const boardUrl = await startLocalBoard();
    const dir = makeTempDir('plandesk-runner-doctor-');
    const configPath = join(dir, 'runner.toml');
    writeFileSync(
      configPath,
      `board_url = "${boardUrl}"\nagent_key = "sk-doctor-key-abcdefgh"\nworkdir = "${join(dir, 'work')}"\n`,
    );
    const workersDir = join(dir, '.agents', 'factory', 'workers');
    mkdirSync(workersDir, { recursive: true });
    writeFileSync(
      join(workersDir, 'pi.md'),
      '---\ntype: worker\nprobe: exit 1\nheadless: pi --print {prompt_file}\n---\n',
    );

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });

    expect(report.resolution?.usable).toEqual([]);
    expect(report.resolution?.excluded[0]?.reason).toBe('probe-failed');
    expect(formatDoctorReport(report)).toContain('usable (0): (none)');
  });
});

describe('formatDoctorReport', () => {
  it('prints the redacted config, board status, and one row per worker', async () => {
    const boardUrl = await startLocalBoard();
    const { configPath, workersDir } = makeFixture(boardUrl);

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });
    const text = formatDoctorReport(report);

    expect(text).toContain('plandesk-runner doctor');
    expect(text).toContain('"boardUrl": "http://127.0.0.1:');
    expect(text).toContain('reachable (HTTP 204)');
    expect(text).toContain('codex');
    expect(text).toContain('pi');
    expect(text).toContain(workersDir);
    expect(text).not.toContain('sk-doctor-key-abcdefgh');
  });

  it('prints repo-declared / config-enabled / probe-ready per worker, then the usable set', async () => {
    const boardUrl = await startLocalBoard();
    const { configPath, workersDir } = makeFullFixture(boardUrl);

    const report = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });
    const text = formatDoctorReport(report);

    expect(report.resolution?.usable.map((worker) => worker.name)).toEqual(['codex', 'pi']);
    expect(text).toContain(
      `  ${'codex'.padEnd(16)} repo-declared=yes config-enabled=yes probe-ready=yes`,
    );
    expect(text).toContain(
      `  ${'pi'.padEnd(16)} repo-declared=yes config-enabled=yes probe-ready=yes version=pi-9.9`,
    );
    expect(text).toContain(
      `  ${'cursor'.padEnd(16)} repo-declared=yes config-enabled=yes probe-ready=n/a — excluded: no headless key in its worker file`,
    );
    expect(text).toContain('usable (2): codex, pi');
  });

  it('marks a config-enabled worker the repo does not declare as repo-declared=no', async () => {
    const boardUrl = await startLocalBoard();
    const { configPath, workersDir } = makeFullFixture(boardUrl, ['pi', 'ghost']);

    const report: DoctorReport = await runDoctor({ configPath, workersDir, timeoutMs: 2000 });
    const text = formatDoctorReport(report);

    expect(text).toContain(
      `  ${'ghost'.padEnd(16)} repo-declared=no config-enabled=yes probe-ready=n/a — not declared by this repository`,
    );
    expect(report.resolution?.enabledButNotDeclared).toEqual(['ghost']);
  });

  it('reports the loopback auth mode when the agent key is empty', async () => {
    const { configPath, workersDir } = makeAuthFixture(
      'board_url = "https://board.example.com"\nagent_key = ""\n',
    );
    const report = await runDoctor({
      configPath,
      workersDir,
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 200 })),
    });
    expect(report.board.authMode).toBe('loopback');
    expect(formatDoctorReport(report)).toContain('loopback');
  });

  it('reports the bearer auth mode and an authenticated probe when a key is set', async () => {
    const { configPath, workersDir } = makeAuthFixture(
      'board_url = "https://board.example.com"\nagent_key = "sk-doctor"\n',
    );
    const seen: string[] = [];
    const report = await runDoctor({
      configPath,
      workersDir,
      fetchImpl: (input) => {
        seen.push(requestUrl(input));
        return Promise.resolve(new Response('[]', { status: 200 }));
      },
    });
    expect(report.board.authMode).toBe('bearer');
    expect(report.board.authenticated).toBe(true);
    expect(seen.some((u) => u.includes('/api/v1/projects'))).toBe(true);
  });

  it('reports authenticated=false when the credential is rejected', async () => {
    const { configPath, workersDir } = makeAuthFixture(
      'board_url = "https://board.example.com"\nagent_key = "sk-bad"\n',
    );
    const report = await runDoctor({
      configPath,
      workersDir,
      fetchImpl: (input) =>
        Promise.resolve(
          new Response('{}', { status: requestUrl(input).includes('/api/v1/projects') ? 401 : 200 }),
        ),
    });
    expect(report.board.reachable).toBe(true);
    expect(report.board.authenticated).toBe(false);
    expect(report.board.authStatus).toBe(401);
    expect(formatDoctorReport(report)).toContain('401');
  });
});
