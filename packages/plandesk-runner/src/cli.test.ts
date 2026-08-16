import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs, UsageError } from './cli.js';
import { AGENT_KEY_ENV, CONFIG_PATH_ENV } from './config.js';

const tempDirs: string[] = [];

beforeEach(() => {
  vi.stubEnv(AGENT_KEY_ENV, '');
  vi.stubEnv(CONFIG_PATH_ENV, '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-runner-cli-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'runner.toml');
  // Port 1 on loopback: refused instantly, so doctor's board ping fails fast.
  writeFileSync(configPath, 'board_url = "http://127.0.0.1:1"\nagent_key = "sk-cli"\n');
  const workersDir = join(dir, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  writeFileSync(join(workersDir, 'pi.md'), '---\ntype: worker\n---\n');
  return dir;
}

describe('parseArgs', () => {
  it('parses a bare invocation as the loop', () => {
    expect(parseArgs([])).toEqual({ command: 'loop' });
  });

  it('parses --once', () => {
    expect(parseArgs(['--once'])).toEqual({ command: 'once' });
  });

  it('parses doctor', () => {
    expect(parseArgs(['doctor'])).toEqual({ command: 'doctor', configPath: undefined });
  });

  it('parses --config before or after the command', () => {
    expect(parseArgs(['--config', '/tmp/runner.toml', 'doctor'])).toEqual({
      command: 'doctor',
      configPath: '/tmp/runner.toml',
    });
    expect(parseArgs(['doctor', '--config=/tmp/runner.toml'])).toEqual({
      command: 'doctor',
      configPath: '/tmp/runner.toml',
    });
  });

  it('throws UsageError for unknown arguments', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(UsageError);
    expect(() => parseArgs(['--warp'])).toThrow(UsageError);
    expect(() => parseArgs(['--config'])).toThrow(UsageError);
  });
});

describe('main', () => {
  it('bare invocation prints a loop stub message and exits 0', async () => {
    await expect(main([])).resolves.toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not implemented'));
  });

  it('--once prints a stub message and exits 0', async () => {
    await expect(main(['--once'])).resolves.toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('--once'));
  });

  it('doctor runs against a fixture config, prints, and exits 0', async () => {
    const dir = makeFixtureRepo();

    const code = await main(['doctor', '--config', join(dir, 'runner.toml')]);

    expect(code).toBe(0);
    const printed = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(printed).toContain('plandesk-runner doctor');
    // Workers discovery walks up from process.cwd() — inside this repo that is
    // the real .agents/factory/workers, so do not pin the count here; the
    // per-row contract is covered in doctor.test.ts with an injected dir.
    expect(printed).toContain('workers (');
    expect(printed).toContain('unreachable');
    expect(printed).not.toContain('sk-cli');
  });

  it('doctor exits 1 with a field-naming error when the config is missing a required field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-runner-badcfg-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'runner.toml');
    writeFileSync(configPath, 'name = "half-configured"\n');

    const code = await main(['doctor', '--config', configPath]);

    expect(code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('board_url is required'));
  });

  it('exits 2 with usage for unknown arguments', async () => {
    await expect(main(['--warp'])).resolves.toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unknown argument'));
  });
});
