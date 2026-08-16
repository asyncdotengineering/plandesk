import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';

/**
 * Runner configuration.
 *
 * The wire format is `~/.plandesk/runner.toml` (snake_case keys, mirroring the
 * worker config shape used by github.com/owainlewis/factory); the type uses
 * camelCase per this repo's TS conventions. `loadConfig` maps between them.
 */
export interface RunnerConfig {
  /** Base URL of the Plan Desk board this runner serves. Required. */
  boardUrl: string;
  /**
   * Agent authentication key. Required as a field; may come from
   * PLANDESK_AGENT_KEY. An EMPTY value selects the unauthenticated loopback
   * path: no `Authorization` header is sent and the board resolves the caller
   * as org owner. Only valid against a board bound to loopback, which cannot
   * mint a key — `plandesk connect` locally mints no token by design.
   */
  agentKey: string;
  /** Runner name shown on the board. Default: os.hostname(). */
  name: string;
  /** Directory the runner uses for checkouts and scratch state. Default: ~/.plandesk/work */
  workdir: string;
  /** Worker ids this runner may dispatch to. Default: [] meaning "all repo-declared". */
  workers: string[];
  /** Worker used when a task does not name one. Optional. */
  defaultWorker?: string;
  /** Concurrent task slots. Default: 1. */
  slots: number;
  /** Poll interval in ms. Default: 2000. */
  pollMs: number;
  /** Task lease duration in ms. Default: 30000. */
  leaseMs: number;
  /** Heartbeat interval in ms. Default: 10000. */
  heartbeatMs: number;
  /** Per-attempt timeout in ms. Default: 3600000. */
  attemptTimeoutMs: number;
  /** Additional repositories this runner may be asked to work in. Default: []. */
  repos: string[];
  /** Scheduling/inventory metadata shown on the runner profile. Default: {}. */
  labels: Record<string, string>;
}

/** Raised for missing required fields, bad values, and unreadable/unparseable config files. */
export class ConfigError extends Error {
  /** The offending field, in wire (snake_case) form: `board_url`, `agent_key`, `slots`, ... */
  readonly field: string;

  constructor(field: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
    this.field = field;
  }
}

export const AGENT_KEY_ENV = 'PLANDESK_AGENT_KEY';
export const CONFIG_PATH_ENV = 'PLANDESK_RUNNER_CONFIG';

export function defaultConfigPath(): string {
  return join(homedir(), '.plandesk', 'runner.toml');
}

export function defaultWorkdir(): string {
  return join(homedir(), '.plandesk', 'work');
}

type RawTable = Record<string, unknown>;

/** Read an env var, treating missing, empty, and whitespace-only values as unset. */
export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readString(raw: RawTable, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ConfigError(key, `runner config field ${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInt(raw: RawTable, key: string, min: number): number | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new ConfigError(key, `runner config field ${key} must be an integer >= ${String(min)}`);
  }
  return value;
}

function readStringArray(raw: RawTable, key: string): string[] | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ConfigError(key, `runner config field ${key} must be an array of strings`);
  }
  return [...(value as string[])];
}

function readLabels(raw: RawTable): Record<string, string> | undefined {
  const value = raw['labels'];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError('labels', 'runner config field labels must be a table of strings');
  }
  const labels: Record<string, string> = {};
  for (const [labelKey, labelValue] of Object.entries(value)) {
    if (typeof labelValue !== 'string') {
      throw new ConfigError('labels', `runner config label ${labelKey} must be a string`);
    }
    labels[labelKey] = labelValue;
  }
  return labels;
}

/**
 * Load the runner config.
 *
 * Resolution order for the file: the `path` argument, then the
 * PLANDESK_RUNNER_CONFIG environment variable, then `~/.plandesk/runner.toml`.
 * An explicitly requested path (argument or env) that does not exist raises
 * ConfigError; a missing default path is tolerated so a runner can be driven
 * purely by environment (required-field validation still applies).
 *
 * `agent_key` falls back to the PLANDESK_AGENT_KEY environment variable when
 * absent from the file. Every other field has a default; `board_url` and
 * `agent_key` are required and raise ConfigError naming the missing field.
 */
export function loadConfig(path?: string): RunnerConfig {
  const explicitPath = path ?? readEnv(CONFIG_PATH_ENV);
  const configPath = explicitPath ?? defaultConfigPath();

  let raw: RawTable = {};
  if (existsSync(configPath)) {
    try {
      const parsed = parse(readFileSync(configPath, 'utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('top-level TOML value must be a table');
      }
      raw = parsed as RawTable;
    } catch (cause) {
      if (cause instanceof ConfigError) {
        throw cause;
      }
      throw new ConfigError(
        'config',
        `failed to parse runner config ${configPath}: ${(cause as Error).message}`,
        { cause },
      );
    }
  } else if (explicitPath !== undefined) {
    throw new ConfigError(
      'config',
      `runner config file not found: ${configPath} (from ${path !== undefined ? 'loadConfig argument' : CONFIG_PATH_ENV})`,
    );
  }

  const boardUrl = readString(raw, 'board_url');
  if (boardUrl === undefined) {
    throw new ConfigError(
      'board_url',
      `runner config field board_url is required — set it in ${configPath}`,
    );
  }

  const rawAgentKey = raw['agent_key'];
  if (rawAgentKey !== undefined && typeof rawAgentKey !== 'string') {
    throw new ConfigError('agent_key', 'runner config field agent_key must be a string');
  }
  // A present-but-empty agent_key is the loopback declaration, not a missing
  // field, so it must not fall through to the environment or the error below.
  const fileAgentKey = typeof rawAgentKey === 'string' ? rawAgentKey.trim() : undefined;
  const agentKey = fileAgentKey ?? readEnv(AGENT_KEY_ENV);
  if (agentKey === undefined) {
    throw new ConfigError(
      'agent_key',
      `runner config field agent_key is required — set it in ${configPath} or the ${AGENT_KEY_ENV} environment variable`,
    );
  }

  return {
    boardUrl,
    agentKey,
    name: readString(raw, 'name') ?? hostname(),
    workdir: readString(raw, 'workdir') ?? defaultWorkdir(),
    workers: readStringArray(raw, 'workers') ?? [],
    defaultWorker: readString(raw, 'default_worker'),
    slots: readPositiveInt(raw, 'slots', 1) ?? 1,
    pollMs: readPositiveInt(raw, 'poll_ms', 1) ?? 2000,
    leaseMs: readPositiveInt(raw, 'lease_ms', 1) ?? 30000,
    heartbeatMs: readPositiveInt(raw, 'heartbeat_ms', 1) ?? 10000,
    attemptTimeoutMs: readPositiveInt(raw, 'attempt_timeout_ms', 1) ?? 3_600_000,
    repos: readStringArray(raw, 'repos') ?? [],
    labels: readLabels(raw) ?? {},
  };
}

/**
 * Return a copy of `config` with `agentKey` masked. The mask carries no
 * characters of the real key (only its length), so the result is safe to
 * print. The input object is not mutated.
 */
export function redact(config: RunnerConfig): RunnerConfig {
  return { ...config, agentKey: `<redacted:${String(config.agentKey.length)}>` };
}
