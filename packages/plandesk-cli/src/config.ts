/**
 * Server configuration for the Node `serve` entry.
 *
 * Three sources, strict precedence: **environment > file > default**.
 *   - The file (`plandesk.server.json`) is developer convenience — it lets a
 *     self-host operator collect every server knob in one place instead of
 *     discovering eight env vars by reading source (REQ-1).
 *   - The environment always wins, so secrets and containers stay 12-factor
 *     and the edge path (Workers/Vercel) needs no file at all (REQ-2, REQ-3).
 *   - The file is never required: missing file is not an error (REQ-3).
 *
 * This module is consumed by the Node entry only (`serve`, `doctor`, `migrate`).
 * Environment parsing is `readServerEnv` from `@plandesk/api` — the same reader
 * the Workers/Vercel entries use — so this file only adds the file overlay and
 * the Node-only host/port.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readServerEnv,
  type GithubConfig,
  type ServerEnv,
  type StorageConfig,
} from '@plandesk/api';
import { DEFAULT_BIND_HOST, DEFAULT_PORT, resolveDataDir } from './args.js';

export const SERVER_CONFIG_FILENAME = 'plandesk.server.json';
export const CLI_CONFIG_FILENAME = 'config.json';
export type CliConfig = { server: string; token: string; orgId: string };

export function cliConfigPath(home = homedir()): string {
  return join(home, '.plandesk', CLI_CONFIG_FILENAME);
}

export function readCliConfig(home = homedir()): CliConfig | undefined {
  const path = cliConfigPath(home);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<CliConfig>;
  if (
    typeof value.server !== 'string' ||
    typeof value.token !== 'string' ||
    typeof value.orgId !== 'string'
  ) {
    throw new ConfigFileError(`${path}: invalid CLI config`);
  }
  return { server: value.server, token: value.token, orgId: value.orgId };
}

export function writeCliConfig(config: CliConfig, home = homedir()): void {
  const path = cliConfigPath(home);
  mkdirSync(join(home, '.plandesk'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function removeCliConfig(home = homedir()): void {
  rmSync(cliConfigPath(home), { force: true });
}

export type ConfigSource = 'default' | 'file' | 'env';

export type ServerConfig = ServerEnv & {
  host: string;
  port: number;
  /** Always resolved — `{ kind: 'db' }` (bytes in the database) by default. */
  storage: StorageConfig;
};

/** Every key `readServerEnv` can set, overlaid onto the file in this order. */
const ENV_KEYS = [
  'dbUrl',
  'dbToken',
  'baseUrl',
  'authSecret',
  'authPassword',
  'storage',
  'github',
] as const satisfies readonly (keyof ServerEnv)[];

export type ConfigKey = (typeof ENV_KEYS)[number] | 'host' | 'port';

export type ResolvedServerConfig = {
  values: ServerConfig;
  /** Source of each resolved key. Absent for optional keys that are unset. */
  sources: Partial<Record<ConfigKey, ConfigSource>>;
  /** Path of the file consulted, when one was present. */
  configFile: string | undefined;
};

/** Strip any embedded `user:pass@` from a URL so it is safe to print. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      parsed.username = 'redacted';
      parsed.password = '';
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Render the resolved config as doctor lines. Secret values are NEVER printed —
 * only their presence and source (REQ-4). Non-secret scalars print their value.
 */
export function formatConfigForDoctor(resolved: ResolvedServerConfig): string[] {
  const { values: v, sources: s, configFile } = resolved;
  const lines: string[] = [];
  const line = (key: string, rendered: string, source: ConfigSource | undefined): void => {
    lines.push(`  ${key}: ${rendered}${source !== undefined ? ` (${source})` : ''}`);
  };
  line('host', v.host, s.host);
  line('port', String(v.port), s.port);
  line('db-url', v.dbUrl !== undefined ? redactUrl(v.dbUrl) : '<unset>', s.dbUrl);
  line('db-token', v.dbToken !== undefined ? '<redacted>' : '<unset>', s.dbToken);
  line('base-url', v.baseUrl ?? '<unset>', s.baseUrl);
  if (v.storage.kind === 's3') {
    line('storage', `s3 [bucket: ${v.storage.bucket}, region: ${v.storage.region}]`, s.storage);
  } else {
    line('storage', 'db', s.storage);
  }
  line('auth-password', v.authPassword !== undefined ? '<redacted>' : '<unset>', s.authPassword);
  line('auth-secret', v.authSecret !== undefined ? '<redacted>' : '<unset>', s.authSecret);
  line('github', v.github !== undefined ? '<redacted>' : '<unset>', s.github);
  lines.push(`  file: ${configFile ?? '<none>'}`);
  return lines;
}

export type ResolveServerConfigOptions = {
  /** Explicit `--config <path>` override. */
  configPath?: string;
  /** Data dir — the file is resolved from here when no explicit path is given. */
  dataDir?: string;
  /** Injectable env (tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

/** Keys whose values must never be printed (doctor redaction, REQ-4). */
export const SECRET_CONFIG_KEYS: ReadonlySet<ConfigKey> = new Set([
  'dbToken',
  'authPassword',
  'authSecret',
]);

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/** Shape of the optional config file. Every field is optional. */
type ServerConfigFile = {
  dbUrl?: unknown;
  dbToken?: unknown;
  host?: unknown;
  port?: unknown;
  baseUrl?: unknown;
  authPassword?: unknown;
  sessionSecret?: unknown;
  storage?: unknown;
  github?: unknown;
};

function assertObject(value: unknown, file: string, key: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigFileError(`${file}: "${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, file: string, key: string): string {
  if (typeof value !== 'string') {
    throw new ConfigFileError(`${file}: "${key}" must be a string`);
  }
  return value;
}

function parsePort(value: unknown, file: string, key: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 65535) {
    throw new ConfigFileError(`${file}: "${key}" must be an integer port (0–65535)`);
  }
  return value;
}

/** Error thrown when the config file exists but is malformed (named, clear). */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

function readConfigFile(path: string): ServerConfigFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // existsSync already passed; a read failure here is unexpected.
    throw new ConfigFileError(`${path}: could not read config file`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigFileError(`${path}: invalid JSON — ${reason}`);
  }
  const obj = assertObject(parsed, path, '<root>');
  const known = new Set<keyof ServerConfigFile>([
    'dbUrl',
    'dbToken',
    'host',
    'port',
    'baseUrl',
    'authPassword',
    'sessionSecret',
    'storage',
    'github',
  ]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key as keyof ServerConfigFile)) {
      throw new ConfigFileError(`${path}: unknown key "${key}"`);
    }
  }
  return obj;
}

function parseStorageFromFile(raw: unknown, file: string): StorageConfig {
  const obj = assertObject(raw, file, 'storage');
  const kind = obj['kind'];
  // "local" is the pre-4.x name for bytes-in-the-database; deployed files still carry it.
  if (kind === 'db' || kind === 'local') {
    return { kind: 'db' };
  }
  if (kind !== 's3') {
    throw new ConfigFileError(`${file}: "storage.kind" must be "db" or "s3"`);
  }
  const endpoint = obj['endpoint'];
  return {
    kind: 's3',
    bucket: assertString(obj['bucket'], file, 'storage.bucket'),
    region: assertString(obj['region'], file, 'storage.region'),
    accessKeyId: assertString(obj['accessKeyId'], file, 'storage.accessKeyId'),
    secretAccessKey: assertString(obj['secretAccessKey'], file, 'storage.secretAccessKey'),
    ...(endpoint !== undefined
      ? { endpoint: assertString(endpoint, file, 'storage.endpoint') }
      : {}),
  };
}

function parseGithubFromFile(raw: unknown, file: string): GithubConfig {
  const obj = assertObject(raw, file, 'github');
  const pick = (key: string): string | undefined =>
    obj[key] === undefined ? undefined : assertString(obj[key], file, `github.${key}`);
  const clientId = pick('clientId');
  const clientSecret = pick('clientSecret');
  const callbackUrl = pick('callbackUrl');
  const dashboardUrl = pick('dashboardUrl');
  if (clientId === undefined || clientSecret === undefined || callbackUrl === undefined) {
    throw new ConfigFileError(
      `${file}: GitHub sign-in needs github.clientId, clientSecret and callbackUrl together. ` +
        'Remove the github block to run without GitHub sign-in.',
    );
  }
  return {
    clientId,
    clientSecret,
    callbackUrl,
    ...(dashboardUrl !== undefined ? { dashboardUrl } : {}),
  };
}

/** The file's values under the same keys `readServerEnv` returns. */
function fileToServerEnv(file: ServerConfigFile, path: string): ServerEnv {
  const str = (key: keyof ServerConfigFile): string | undefined =>
    file[key] === undefined ? undefined : assertString(file[key], path, key);
  return {
    dbUrl: str('dbUrl'),
    dbToken: str('dbToken'),
    baseUrl: str('baseUrl'),
    authSecret: str('sessionSecret'),
    authPassword: str('authPassword'),
    storage: file.storage === undefined ? undefined : parseStorageFromFile(file.storage, path),
    github: file.github === undefined ? undefined : parseGithubFromFile(file.github, path),
  };
}

function resolveConfigFilePath(opts: ResolveServerConfigOptions): string | undefined {
  if (opts.configPath !== undefined && opts.configPath.trim() !== '') {
    return opts.configPath;
  }
  const dataDir = resolveDataDir(opts.dataDir);
  return join(dataDir, SERVER_CONFIG_FILENAME);
}

/**
 * Resolve the server config: environment > file > default (REQ-1, REQ-2).
 *
 * A missing file is not an error — the result falls back to env then defaults.
 * A present-but-malformed file throws {@link ConfigFileError}, naming the file
 * and the offending key.
 */
export function resolveServerConfig(opts: ResolveServerConfigOptions = {}): ResolvedServerConfig {
  const env = opts.env ?? process.env;
  const sources: Partial<Record<ConfigKey, ConfigSource>> = {};

  const configFilePath = resolveConfigFilePath(opts);
  const configFile =
    configFilePath !== undefined && existsSync(configFilePath) ? configFilePath : undefined;
  const file = configFile !== undefined ? readConfigFile(configFile) : undefined;

  // --- host: flag callers layer on top; here it's env > file > default ---
  let host: string;
  if (present(env.PLANDESK_HOST)) {
    host = env.PLANDESK_HOST.trim();
    sources.host = 'env';
  } else if (file?.host !== undefined) {
    host = assertString(file.host, configFilePath ?? '<file>', 'host');
    sources.host = 'file';
  } else {
    host = DEFAULT_BIND_HOST;
    sources.host = 'default';
  }

  // --- port ---
  let port: number;
  const envPortRaw = env.PLANDESK_PORT;
  if (
    envPortRaw !== undefined &&
    envPortRaw.trim() !== '' &&
    Number.isInteger(Number(envPortRaw))
  ) {
    const n = Number(envPortRaw);
    if (n >= 0 && n <= 65535) {
      port = n;
      sources.port = 'env';
    } else {
      port = DEFAULT_PORT;
      sources.port = 'default';
    }
  } else if (file?.port !== undefined) {
    port = parsePort(file.port, configFilePath ?? '<file>', 'port');
    sources.port = 'file';
  } else {
    port = DEFAULT_PORT;
    sources.port = 'default';
  }

  // Every other key: environment (one reader, shared with Workers/Vercel) over file.
  const fromEnv = readServerEnv(env);
  const fromFile = file !== undefined ? fileToServerEnv(file, configFilePath ?? '<file>') : {};
  const overlay: ServerEnv = {};
  for (const key of ENV_KEYS) {
    if (fromEnv[key] !== undefined) {
      Object.assign(overlay, { [key]: fromEnv[key] });
      sources[key] = 'env';
    } else if (fromFile[key] !== undefined) {
      Object.assign(overlay, { [key]: fromFile[key] });
      sources[key] = 'file';
    }
  }
  sources.storage ??= 'default';

  return {
    values: { ...overlay, host, port, storage: overlay.storage ?? { kind: 'db' } },
    sources,
    configFile,
  };
}
