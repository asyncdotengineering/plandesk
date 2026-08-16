import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_KEY_ENV, CONFIG_PATH_ENV, ConfigError, loadConfig, redact } from './config.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeToml(text: string): string {
  const dir = makeTempDir('plandesk-runner-config-');
  const path = join(dir, 'runner.toml');
  writeFileSync(path, text);
  return path;
}

const MINIMAL_TOML = `
board_url = "https://board.example.com"
agent_key = "sk-test-key-0123456789"
`;

const FULL_TOML = `
board_url = "https://clientdesk.asyncdot.com"
agent_key = "sk-live-key-abcdefghijklmnop"
name      = "vps-1"
workdir   = "/srv/plandesk"
workers        = ["pi", "codex", "claude"]
default_worker = "pi"
slots = 1
poll_ms = 2000
lease_ms = 30000
heartbeat_ms = 10000
attempt_timeout_ms = 3600000
repos = ["git@github.com:you/repo.git"]
[labels]
host = "hetzner-fsn1"
`;

beforeEach(() => {
  // Empty string means "unset" to the loader; vi.unstubAllEnvars restores the
  // real environment afterwards.
  vi.stubEnv(AGENT_KEY_ENV, '');
  vi.stubEnv(CONFIG_PATH_ENV, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function expectConfigError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('expected loadConfig to throw, but it resolved');
}

describe('loadConfig', () => {
  it('loads a minimal config and applies every documented default', () => {
    const path = writeToml(MINIMAL_TOML);

    expect(loadConfig(path)).toEqual({
      boardUrl: 'https://board.example.com',
      agentKey: 'sk-test-key-0123456789',
      name: hostname(),
      workdir: join(homedir(), '.plandesk', 'work'),
      workers: [],
      defaultWorker: undefined,
      slots: 1,
      pollMs: 2000,
      leaseMs: 30000,
      heartbeatMs: 10000,
      attemptTimeoutMs: 3_600_000,
      repos: [],
      labels: {},
    });
  });

  it('maps every snake_case wire field to its camelCase counterpart', () => {
    const path = writeToml(FULL_TOML);

    expect(loadConfig(path)).toEqual({
      boardUrl: 'https://clientdesk.asyncdot.com',
      agentKey: 'sk-live-key-abcdefghijklmnop',
      name: 'vps-1',
      workdir: '/srv/plandesk',
      workers: ['pi', 'codex', 'claude'],
      defaultWorker: 'pi',
      slots: 1,
      pollMs: 2000,
      leaseMs: 30000,
      heartbeatMs: 10000,
      attemptTimeoutMs: 3_600_000,
      repos: ['git@github.com:you/repo.git'],
      labels: { host: 'hetzner-fsn1' },
    });
  });

  it('throws ConfigError naming board_url when board_url is missing', () => {
    const path = writeToml('agent_key = "sk-test"\n');

    const error = expectConfigError(() => loadConfig(path));
    expect(error.field).toBe('board_url');
    expect(error.message).toContain('board_url');
  });

  it('throws ConfigError naming agent_key when agent_key is missing everywhere', () => {
    const path = writeToml('board_url = "https://board.example.com"\n');

    const error = expectConfigError(() => loadConfig(path));
    expect(error.field).toBe('agent_key');
  });

  it('resolves agent_key from PLANDESK_AGENT_KEY when absent from the file', () => {
    const path = writeToml('board_url = "https://board.example.com"\n');
    vi.stubEnv(AGENT_KEY_ENV, 'sk-from-environment');

    const config = loadConfig(path);
    expect(config.agentKey).toBe('sk-from-environment');
  });

  it('prefers the file agent_key over PLANDESK_AGENT_KEY', () => {
    const path = writeToml(MINIMAL_TOML);
    vi.stubEnv(AGENT_KEY_ENV, 'sk-from-environment');

    const config = loadConfig(path);
    expect(config.agentKey).toBe('sk-test-key-0123456789');
  });

  it('honors PLANDESK_RUNNER_CONFIG over the default path', () => {
    const path = writeToml(MINIMAL_TOML);
    vi.stubEnv(CONFIG_PATH_ENV, path);

    const config = loadConfig();
    expect(config.boardUrl).toBe('https://board.example.com');
  });

  it('throws ConfigError for an explicit path that does not exist', () => {
    const dir = makeTempDir('plandesk-runner-missing-');

    const error = expectConfigError(() => loadConfig(join(dir, 'nope.toml')));
    expect(error.message).toContain('nope.toml');
  });

  it('throws ConfigError for malformed TOML', () => {
    const path = writeToml('board_url = "unterminated\n');

    const error = expectConfigError(() => loadConfig(path));
    expect(error.message).toContain('failed to parse');
  });

  it('throws ConfigError naming the field when slots is not a positive integer', () => {
    const path = writeToml(`${MINIMAL_TOML}\nslots = 0\n`);

    const error = expectConfigError(() => loadConfig(path));
    expect(error.field).toBe('slots');
  });

  it('throws ConfigError naming the field when workers is not a string array', () => {
    const path = writeToml(`${MINIMAL_TOML}\nworkers = ["pi", 42]\n`);

    const error = expectConfigError(() => loadConfig(path));
    expect(error.field).toBe('workers');
  });

  it('throws ConfigError naming the field when a label is not a string', () => {
    const path = writeToml(`${MINIMAL_TOML}\n[labels]\nhost = 7\n`);

    const error = expectConfigError(() => loadConfig(path));
    expect(error.field).toBe('labels');
  });
});

describe('redact', () => {
  it('masks agent_key without leaking any substring of the real key', () => {
    const config = loadConfig(writeToml(MINIMAL_TOML));
    const key = config.agentKey;

    const redacted = redact(config);
    const printed = JSON.stringify(redacted);

    expect(printed).not.toContain(key);
    // Stronger than "the whole key is absent": no window of the key may appear.
    for (let i = 0; i + 4 <= key.length; i++) {
      expect(printed).not.toContain(key.slice(i, i + 4));
    }
  });

  it('preserves every other field and does not mutate the input', () => {
    const config = loadConfig(writeToml(FULL_TOML));

    const redacted = redact(config);

    expect(redacted).not.toBe(config);
    expect(redacted.boardUrl).toBe(config.boardUrl);
    expect(redacted.name).toBe(config.name);
    expect(redacted.workdir).toBe(config.workdir);
    expect(redacted.workers).toEqual(config.workers);
    expect(redacted.defaultWorker).toBe(config.defaultWorker);
    expect(redacted.slots).toBe(config.slots);
    expect(redacted.labels).toEqual(config.labels);
    expect(config.agentKey).toBe('sk-live-key-abcdefghijklmnop');
  });

  it('accepts an explicitly empty agent_key as the unauthenticated loopback declaration', () => {
    const path = writeToml('board_url = "https://board.example.com"\nagent_key = ""\n');
    const config = loadConfig(path);
    expect(config.agentKey).toBe('');
  });

  it('accepts a whitespace-only agent_key as empty rather than treating it as a credential', () => {
    const path = writeToml('board_url = "https://board.example.com"\nagent_key = "   "\n');
    expect(loadConfig(path).agentKey).toBe('');
  });
});
