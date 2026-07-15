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
 * The Workers/Vercel entries read their runtime env bindings directly and never
 * import this — that keeps the cloud path file-free.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_BIND_HOST, DEFAULT_PORT, resolveDataDir } from './args.js';

export const SERVER_CONFIG_FILENAME = 'plandesk.server.json';

export type ConfigSource = 'default' | 'file' | 'env';

export type GithubServerConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  dashboardUrl?: string;
};

export type S3ServerConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
};

export type StorageServerConfig =
  | { kind: 'local' }
  | ({ kind: 's3' } & S3ServerConfig);

export type ServerConfig = {
  /** Remote libSQL/Turso URL. Unset → local file SQLite (the local topology). */
  dbUrl?: string;
  /** Auth token for a remote libSQL DB. */
  dbToken?: string;
  host: string;
  port: number;
  /** Public base URL the server is reachable at (callbacks/links). */
  baseUrl?: string;
  storage: StorageServerConfig;
  /** GitHub OAuth (browser sign-in). All-or-nothing: all three or none. */
  github?: GithubServerConfig;
  /** HTTP basic-auth password for the UI/REST API. */
  authPassword?: string;
  /**
   * Session signing secret. Reserved: the current session impl is DB-backed
   * opaque tokens, but the key is resolvable + reportable now so an operator
   * can set it without a redeploy when signed-cookie support lands.
   */
  sessionSecret?: string;
};

export type ConfigKey =
  | 'dbUrl'
  | 'dbToken'
  | 'host'
  | 'port'
  | 'baseUrl'
  | 'storage'
  | 'github'
  | 'authPassword'
  | 'sessionSecret';

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
    line('storage', 'local', s.storage);
  }
  line('auth-password', v.authPassword !== undefined ? '<redacted>' : '<unset>', s.authPassword);
  line('session-secret', v.sessionSecret !== undefined ? '<redacted>' : '<unset>', s.sessionSecret);
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
  'sessionSecret',
]);

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function trim(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
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

function assertString(
  value: unknown,
  file: string,
  key: string,
): string {
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

function parseS3FromFile(raw: unknown, file: string): S3ServerConfig {
  const obj = assertObject(raw, file, 'storage');
  const bucket = assertString(obj['bucket'], file, 'storage.bucket');
  const region = assertString(obj['region'], file, 'storage.region');
  const accessKeyId = assertString(obj['accessKeyId'], file, 'storage.accessKeyId');
  const secretAccessKey = assertString(obj['secretAccessKey'], file, 'storage.secretAccessKey');
  const endpoint = obj['endpoint'];
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint: typeof endpoint === 'string' ? endpoint : undefined,
  };
}

function parseGithubFromFile(raw: unknown, file: string): Partial<GithubServerConfig> {
  const obj = assertObject(raw, file, 'github');
  const pick = (key: string): string | undefined => {
    const value = obj[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new ConfigFileError(`${file}: "github.${key}" must be a string`);
    }
    return value;
  };
  return {
    clientId: pick('clientId'),
    clientSecret: pick('clientSecret'),
    callbackUrl: pick('callbackUrl'),
    dashboardUrl: pick('dashboardUrl'),
  };
}

type FileStorage = { kind: 'local' } | ({ kind: 's3' } & S3ServerConfig);

function parseStorageFromFile(raw: unknown, file: string): FileStorage {
  const obj = assertObject(raw, file, 'storage');
  const kindRaw = obj['kind'];
  if (kindRaw !== 'local' && kindRaw !== 's3') {
    throw new ConfigFileError(`${file}: "storage.kind" must be "local" or "s3"`);
  }
  if (kindRaw === 'local') {
    return { kind: 'local' };
  }
  return { kind: 's3', ...parseS3FromFile(obj, file) };
}

function resolveStorage(
  file: ServerConfigFile | undefined,
  env: NodeJS.ProcessEnv,
  filePath: string | undefined,
): { storage: StorageServerConfig; source: ConfigSource } {
  const fileStorage = file?.storage !== undefined ? parseStorageFromFile(file.storage, filePath ?? '<file>') : undefined;

  const envKind = env.PLANDESK_STORAGE;
  if (envKind !== undefined && envKind !== 's3' && envKind !== 'local') {
    throw new Error(`Unknown PLANDESK_STORAGE adapter: "${envKind}". Expected "local" or "s3".`);
  }

  // The selector: environment wins, then the file, then local default.
  const wantS3 = envKind === 's3' || fileStorage?.kind === 's3';
  if (!wantS3) {
    const source: ConfigSource = envKind === 'local' ? 'env' : fileStorage !== undefined ? 'file' : 'default';
    return { storage: { kind: 'local' }, source };
  }

  // S3: credentials merge env > file; all four required.
  const fromFile = fileStorage?.kind === 's3' ? fileStorage : undefined;
  const bucket = trim(env.PLANDESK_S3_BUCKET) ?? fromFile?.bucket;
  const region = trim(env.PLANDESK_S3_REGION) ?? fromFile?.region;
  const accessKeyId = trim(env.PLANDESK_S3_ACCESS_KEY_ID) ?? fromFile?.accessKeyId;
  const secretAccessKey = trim(env.PLANDESK_S3_SECRET_ACCESS_KEY) ?? fromFile?.secretAccessKey;
  const endpoint = trim(env.PLANDESK_S3_ENDPOINT) ?? fromFile?.endpoint;

  if (bucket === undefined || region === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      'storage=s3 requires PLANDESK_S3_BUCKET, PLANDESK_S3_REGION, PLANDESK_S3_ACCESS_KEY_ID, and ' +
        'PLANDESK_S3_SECRET_ACCESS_KEY (env, or storage.* in plandesk.server.json).',
    );
  }
  const source: ConfigSource = envKind === 's3' || env.PLANDESK_S3_BUCKET !== undefined ? 'env' : 'file';
  return { storage: { kind: 's3', bucket, region, accessKeyId, secretAccessKey, endpoint }, source };
}

function resolveGithub(
  file: ServerConfigFile | undefined,
  env: NodeJS.ProcessEnv,
  filePath: string | undefined,
): { github: GithubServerConfig | undefined; source: ConfigSource } {
  const fileGithub = file?.github !== undefined ? parseGithubFromFile(file.github, filePath ?? '<file>') : undefined;
  const clientId = trim(env.PLANDESK_GITHUB_CLIENT_ID) ?? fileGithub?.clientId;
  const clientSecret = trim(env.PLANDESK_GITHUB_CLIENT_SECRET) ?? fileGithub?.clientSecret;
  const callbackUrl = trim(env.PLANDESK_GITHUB_CALLBACK_URL) ?? fileGithub?.callbackUrl;
  const dashboardUrl = trim(env.PLANDESK_DASHBOARD_URL) ?? fileGithub?.dashboardUrl;

  const set = [clientId, clientSecret, callbackUrl].filter((v) => v !== undefined);
  if (set.length === 0) {
    return { github: undefined, source: 'default' };
  }
  if (set.length !== 3) {
    throw new Error(
      'GitHub sign-in needs clientId, clientSecret and callbackUrl together (PLANDESK_GITHUB_CLIENT_ID, ' +
        'PLANDESK_GITHUB_CLIENT_SECRET, PLANDESK_GITHUB_CALLBACK_URL, or github.* in plandesk.server.json). ' +
        'Unset all three to run without GitHub sign-in.',
    );
  }
  const source: ConfigSource = env.PLANDESK_GITHUB_CLIENT_ID !== undefined ? 'env' : 'file';
  return {
    github: { clientId: clientId as string, clientSecret: clientSecret as string, callbackUrl: callbackUrl as string, dashboardUrl },
    source,
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
  if (envPortRaw !== undefined && envPortRaw.trim() !== '' && Number.isInteger(Number(envPortRaw))) {
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

  // --- dbUrl ---
  let dbUrl: string | undefined;
  if (present(env.PLANDESK_DB_URL)) {
    dbUrl = env.PLANDESK_DB_URL.trim();
    sources.dbUrl = 'env';
  } else if (file?.dbUrl !== undefined) {
    dbUrl = assertString(file.dbUrl, configFilePath ?? '<file>', 'dbUrl');
    sources.dbUrl = 'file';
  }

  // --- dbToken ---
  let dbToken: string | undefined;
  if (present(env.PLANDESK_DB_TOKEN)) {
    dbToken = env.PLANDESK_DB_TOKEN.trim();
    sources.dbToken = 'env';
  } else if (file?.dbToken !== undefined) {
    dbToken = assertString(file.dbToken, configFilePath ?? '<file>', 'dbToken');
    sources.dbToken = 'file';
  }

  // --- baseUrl ---
  let baseUrl: string | undefined;
  if (present(env.PLANDESK_BASE_URL)) {
    baseUrl = env.PLANDESK_BASE_URL.trim();
    sources.baseUrl = 'env';
  } else if (file?.baseUrl !== undefined) {
    baseUrl = assertString(file.baseUrl, configFilePath ?? '<file>', 'baseUrl');
    sources.baseUrl = 'file';
  }

  // --- authPassword ---
  let authPassword: string | undefined;
  if (present(env.PLANDESK_AUTH_PASSWORD)) {
    authPassword = env.PLANDESK_AUTH_PASSWORD.trim();
    sources.authPassword = 'env';
  } else if (file?.authPassword !== undefined) {
    authPassword = assertString(file.authPassword, configFilePath ?? '<file>', 'authPassword');
    sources.authPassword = 'file';
  }

  // --- sessionSecret ---
  let sessionSecret: string | undefined;
  if (present(env.PLANDESK_SESSION_SECRET)) {
    sessionSecret = env.PLANDESK_SESSION_SECRET.trim();
    sources.sessionSecret = 'env';
  } else if (file?.sessionSecret !== undefined) {
    sessionSecret = assertString(file.sessionSecret, configFilePath ?? '<file>', 'sessionSecret');
    sources.sessionSecret = 'file';
  }

  const { storage, source: storageSource } = resolveStorage(file, env, configFilePath);
  sources.storage = storageSource;

  const { github, source: githubSource } = resolveGithub(file, env, configFilePath);
  if (github !== undefined) {
    sources.github = githubSource;
  }

  return {
    values: { dbUrl, dbToken, host, port, baseUrl, storage, github, authPassword, sessionSecret },
    sources,
    configFile,
  };
}
