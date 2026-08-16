import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_KEY_ENV, CONFIG_PATH_ENV } from './config.js';
import { formatDoctorReport, runDoctor } from './doctor.js';

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

function makeFixture(boardUrl: string): { configPath: string; workersDir: string } {
  const dir = makeTempDir('plandesk-runner-doctor-');
  const configPath = join(dir, 'runner.toml');
  writeFileSync(configPath, `board_url = "${boardUrl}"\nagent_key = "sk-doctor-key-abcdefgh"\n`);
  const workersDir = join(dir, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  writeFileSync(join(workersDir, 'pi.md'), '---\ntype: worker\n---\n');
  writeFileSync(join(workersDir, 'codex.md'), '---\ntype: worker\n---\n');
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
    writeFileSync(configPath, `board_url = "${boardUrl}"\nagent_key = "sk-doctor-key-abcdefgh"\n`);

    const report = await runDoctor({ configPath, cwd: dir, timeoutMs: 2000 });

    expect(report.workersDir).toBeUndefined();
    expect(report.workers).toEqual([]);
    expect(formatDoctorReport(report)).toContain('no .agents/factory/workers directory found');
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
});
