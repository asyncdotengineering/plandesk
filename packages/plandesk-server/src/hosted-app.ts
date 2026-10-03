/**
 * The one composition: the API app with the MCP app mounted, over a database
 * the server prepares itself. The Workers, Vercel and Node (`plandesk serve`,
 * Docker) entries differ only in the platform they pass in.
 *
 * This lives outside `@plandesk/api` because `@plandesk/mcp` imports runtime
 * values from `api`, so `api` cannot import `mcp` back. Vercel's entry sat in
 * `api` and never served /mcp/ for exactly that reason.
 */
import { Hono } from 'hono';
import { SchemaDriftError, type Db, type ReferenceCheckFs } from '@plandesk/db';
import {
  createApp,
  createBetterAuth,
  createServices,
  createStorageAdapter,
  hostedMisconfigResponse,
  isLoopbackBind,
  prepareDatabase,
  readServerEnv,
  resolveHostedBetterAuth,
  ServerEnvError,
  type R2BucketLike,
  type ServerEnv,
} from '@plandesk/api';
import { createMcpApp } from '@plandesk/mcp';

export type HostedPlatform = {
  /** Opens PLANDESK_DB_URL: the web client on Workers, the Node client elsewhere. */
  openDb: (url: string, token?: string) => Promise<Db>;
  /** Workers R2 binding; wins over S3 config, which wins over bytes in the database. */
  files?: R2BucketLike;
  /** better-auth baseURL fallback when PLANDESK_BASE_URL is unset. */
  requestOrigin?: string;
  /**
   * Where the server listens (default 0.0.0.0). A loopback bind trusts its
   * caller as the machine owner, so better-auth becomes optional there.
   */
  bindHost?: string;
  /** Local single-org board: prepare also ensures the local organization. */
  local?: boolean;
  /** Board directory, surfaced on /api/v1/health for identity checks. */
  dataDir?: string;
  /** Disk access for check_references. */
  referenceCheckFs?: ReferenceCheckFs;
  /** Serves the web SPA from the app itself (Node); edge entries use platform assets. */
  mountStatic?: (app: Hono) => void;
  /** Runs after each successful prepare, before the first request is served. */
  afterPrepare?: (db: Db) => Promise<unknown>;
};

/** How long a prepare waits for another instance's lease before answering 503. */
const PREPARE_WAIT_MS = 2_000;
/** A failed prepare is replayed for this long, so a stale database is never hammered. */
const PREPARE_RETRY_MS = 2_000;

let cached: { env: object; app: Promise<Hono> } | undefined;

/**
 * Memoised by `env` identity, so an isolate or process reads its env, opens its
 * database and builds its app once. A build that throws is not kept; a bad env
 * answers JSON 500 `misconfigured` instead of throwing.
 */
export function createHostedApp(
  env: Readonly<Record<string, unknown>>,
  platform: HostedPlatform,
): Promise<Hono> {
  if (cached?.env !== env) {
    const app = build(env, platform);
    cached = { env, app };
    app.catch(() => {
      if (cached?.app === app) cached = undefined;
    });
  }
  return cached.app;
}

async function build(
  env: Readonly<Record<string, unknown>>,
  platform: HostedPlatform,
): Promise<Hono> {
  try {
    return (await composeApp(readServerEnv(env), platform)).app;
  } catch (err) {
    if (hostedMisconfigResponse(err) === undefined) throw err;
    return new Hono().all('*', () => hostedMisconfigResponse(err) as Response);
  }
}

/**
 * Builds the app over an already-resolved config. Every request passes the
 * prepare gate; `prepare` is the same memoised attempt, for an entry that
 * prepares at boot. Throws on a config the server cannot run with.
 */
export async function composeApp(
  config: ServerEnv,
  platform: HostedPlatform,
): Promise<{ app: Hono; prepare: () => Promise<unknown> }> {
  if (config.dbUrl === undefined) {
    throw new ServerEnvError('Hosted Plan Desk requires PLANDESK_DB_URL (libSQL/Turso URL).');
  }
  const bindHost = platform.bindHost ?? '0.0.0.0';
  // Off loopback every request needs a token or a session, so a missing secret
  // fails loud. On loopback the board runs without better-auth, but its tables
  // are still prepared, so a throwaway secret drives the migrator.
  const betterAuth =
    config.authSecret === undefined && isLoopbackBind(bindHost)
      ? undefined
      : resolveHostedBetterAuth(config, platform.requestOrigin);
  const db = await platform.openDb(config.dbUrl, config.dbToken);
  const auth = createBetterAuth({
    client: db.$client,
    db,
    secret: betterAuth?.secret ?? globalThis.crypto.randomUUID(),
    baseURL: betterAuth?.baseURL ?? platform.requestOrigin ?? 'http://127.0.0.1',
    github: config.github,
  });
  if (auth === undefined) throw new Error('better-auth instance could not be created');
  const storage = createStorageAdapter({ db, storage: config.storage, r2: platform.files });
  const services = createServices({
    db,
    auth,
    storage,
    referenceCheckFs: platform.referenceCheckFs,
  });
  const inner = createApp({
    db,
    services,
    // Stateless streamable HTTP: no session store, so it runs on an isolate.
    mcp: createMcpApp({ services, bindHost }),
    authPassword: config.authPassword,
    bindHost,
    dataDir: platform.dataDir,
    github: config.github,
    ...(betterAuth !== undefined ? { betterAuth, betterAuthInstance: auth } : {}),
  });
  platform.mountStatic?.(inner);

  let ready: Promise<unknown> | undefined;
  let retryAt = Infinity;
  let behind = false;
  const prepare = (): Promise<unknown> => {
    if (ready === undefined || Date.now() >= retryAt) {
      retryAt = Infinity;
      // Short wait: while another instance holds the lease, answer 503 fast
      // rather than hold the request open.
      const attempt = prepareDatabase(db, auth, {
        waitMs: PREPARE_WAIT_MS,
        local: platform.local,
      }).then(() => platform.afterPrepare?.(db));
      ready = attempt;
      // Request-driven, not a timer: a Worker isolate may never run one.
      attempt.then(
        () => {
          behind = false;
        },
        (err: unknown) => {
          retryAt = Date.now() + PREPARE_RETRY_MS;
          if (err instanceof SchemaDriftError && !behind) {
            console.error(`${err.message} Answering 503 until it is current.`);
          }
          behind = err instanceof SchemaDriftError;
        },
      );
    }
    return ready;
  };

  const app = new Hono();
  app.use('*', async (c, next) => {
    try {
      await prepare();
    } catch (err) {
      if (!(err instanceof SchemaDriftError)) throw err;
      return c.json({ error: 'schema_behind', schema: err.summary }, 503);
    }
    await next();
  });
  app.mount('/', inner.fetch);
  return { app, prepare };
}
