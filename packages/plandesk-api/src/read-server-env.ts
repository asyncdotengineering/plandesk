/**
 * The one place server configuration is read from the environment. Node
 * (`plandesk serve`), the Workers entry and the Vercel entry all call this, so
 * every target applies the same rules: values are trimmed, blank means unset,
 * GitHub and S3 are all-or-nothing, and a half-set group throws naming what is
 * missing rather than silently switching the feature off.
 *
 * Pure — no filesystem, no `process` — so it runs on any runtime. R2 is not an
 * env choice: it is a platform binding the Worker passes in directly.
 */

export type GithubConfig = {
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL registered with the GitHub app. */
  callbackUrl: string;
  /** Where to land the browser once the cookie is set. */
  dashboardUrl?: string;
};

export type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
};

/** Where file bytes live: in the database (any target) or S3-compatible storage. */
export type StorageConfig = { kind: 'db' } | ({ kind: 's3' } & S3Config);

export type ServerEnv = {
  /** Remote libSQL/Turso URL. */
  dbUrl?: string;
  dbToken?: string;
  /** Public origin the server is reachable at (callbacks, share links). */
  baseUrl?: string;
  /** better-auth secret (sessions + API keys). */
  authSecret?: string;
  /** HTTP basic-auth password for the UI/REST API. */
  authPassword?: string;
  /** Undefined when PLANDESK_STORAGE is unset — the caller picks the default. */
  storage?: StorageConfig;
  /** Undefined → no GitHub sign-in (the supported self-host path). */
  github?: GithubConfig;
};

const S3_VARS = [
  'PLANDESK_S3_BUCKET',
  'PLANDESK_S3_REGION',
  'PLANDESK_S3_ACCESS_KEY_ID',
  'PLANDESK_S3_SECRET_ACCESS_KEY',
] as const;

const GITHUB_VARS = [
  'PLANDESK_GITHUB_CLIENT_ID',
  'PLANDESK_GITHUB_CLIENT_SECRET',
  'PLANDESK_GITHUB_CALLBACK_URL',
] as const;

/** The environment names a configuration the server cannot run with. */
export class ServerEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerEnvError';
  }
}

/** `env` may carry non-string platform bindings (Workers); only strings are read. */
export function readServerEnv(env: Readonly<Record<string, unknown>>): ServerEnv {
  const get = (name: string): string | undefined => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const authSecret = get('PLANDESK_BETTER_AUTH_SECRET');
  if (authSecret === undefined && get('PLANDESK_SESSION_SECRET') !== undefined) {
    throw new ServerEnvError(
      'PLANDESK_SESSION_SECRET is no longer read. Rename it to PLANDESK_BETTER_AUTH_SECRET ' +
        '(same value) and restart.',
    );
  }

  return {
    dbUrl: get('PLANDESK_DB_URL'),
    dbToken: get('PLANDESK_DB_TOKEN'),
    baseUrl: get('PLANDESK_BASE_URL'),
    authSecret,
    authPassword: get('PLANDESK_AUTH_PASSWORD'),
    storage: readStorage(get),
    github: readGithub(get),
  };
}

function readStorage(get: (name: string) => string | undefined): StorageConfig | undefined {
  const kind = get('PLANDESK_STORAGE');
  const s3 = S3_VARS.map(get);
  const [bucket, region, accessKeyId, secretAccessKey] = s3;
  if (kind === undefined) {
    if (s3.some((value) => value !== undefined)) {
      throw new ServerEnvError(
        'PLANDESK_S3_* is set but PLANDESK_STORAGE is not. Set PLANDESK_STORAGE=s3.',
      );
    }
    return undefined;
  }
  // 'local' is the pre-4.x name for bytes-in-the-database, still in deployed env files.
  if (kind === 'db' || kind === 'local') return { kind: 'db' };
  if (kind !== 's3') {
    throw new ServerEnvError(`Unknown PLANDESK_STORAGE "${kind}". Expected "db" or "s3".`);
  }
  if (
    bucket === undefined ||
    region === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    throw new ServerEnvError(`PLANDESK_STORAGE=s3 requires ${S3_VARS.join(', ')}.`);
  }
  const endpoint = get('PLANDESK_S3_ENDPOINT');
  return {
    kind: 's3',
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    ...(endpoint !== undefined ? { endpoint } : {}),
  };
}

function readGithub(get: (name: string) => string | undefined): GithubConfig | undefined {
  const [clientId, clientSecret, callbackUrl] = GITHUB_VARS.map(get);
  if (clientId === undefined && clientSecret === undefined && callbackUrl === undefined) {
    return undefined;
  }
  if (clientId === undefined || clientSecret === undefined || callbackUrl === undefined) {
    throw new ServerEnvError(
      `GitHub sign-in needs ${GITHUB_VARS.join(', ')} together. ` +
        'Unset all three to run without GitHub sign-in.',
    );
  }
  const dashboardUrl = get('PLANDESK_DASHBOARD_URL');
  return {
    clientId,
    clientSecret,
    callbackUrl,
    ...(dashboardUrl !== undefined ? { dashboardUrl } : {}),
  };
}
