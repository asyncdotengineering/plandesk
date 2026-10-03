/**
 * The one hosted composition: the API app with the MCP app mounted, over a
 * database the server prepares itself. The Workers and Vercel entries differ
 * only in how they open the database and whether an R2 binding exists.
 *
 * This lives outside `@plandesk/api` because `@plandesk/mcp` imports runtime
 * values from `api`, so `api` cannot import `mcp` back. Vercel's entry sat in
 * `api` and never served /mcp/ for exactly that reason.
 */
import { Hono } from 'hono';
import { SchemaDriftError, type Db } from '@plandesk/db';
import {
  createApp,
  createBetterAuth,
  createServices,
  createStorageAdapter,
  hostedMisconfigResponse,
  prepareDatabase,
  readServerEnv,
  resolveHostedBetterAuth,
  ServerEnvError,
  type R2BucketLike,
} from '@plandesk/api';
import { createMcpApp } from '@plandesk/mcp';

export type HostedPlatform = {
  /** Opens PLANDESK_DB_URL: the web client on Workers, the Node client on Vercel. */
  openDb: (url: string, token?: string) => Promise<Db>;
  /** Workers R2 binding; wins over S3 config, which wins over bytes in the database. */
  files?: R2BucketLike;
  /** better-auth baseURL fallback when PLANDESK_BASE_URL is unset. */
  requestOrigin?: string;
};

const PREPARE_WAIT_MS = 2_000;

let cached: { env: object; app: Promise<Hono> } | undefined;

/**
 * Memoised by `env` identity, so an isolate or process reads its env, opens its
 * database and builds its app once. A build that throws is not kept.
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
    const serverEnv = readServerEnv(env);
    if (serverEnv.dbUrl === undefined) {
      throw new ServerEnvError('Hosted Plan Desk requires PLANDESK_DB_URL (libSQL/Turso URL).');
    }
    const betterAuth = resolveHostedBetterAuth(serverEnv, platform.requestOrigin);
    const db = await platform.openDb(serverEnv.dbUrl, serverEnv.dbToken);
    const auth = createBetterAuth({
      client: db.$client,
      db,
      secret: betterAuth.secret,
      baseURL: betterAuth.baseURL,
      github: serverEnv.github,
    });
    if (auth === undefined) throw new Error('Hosted better-auth instance could not be created');
    const storage = createStorageAdapter({ db, storage: serverEnv.storage, r2: platform.files });
    const services = createServices({ db, auth, storage });
    const inner = createApp({
      db,
      services,
      // Stateless streamable HTTP: no session store, so it runs on an isolate.
      mcp: createMcpApp({ services, bindHost: '0.0.0.0' }),
      authPassword: serverEnv.authPassword,
      // Non-loopback: every request needs a token or a session.
      bindHost: '0.0.0.0',
      github: serverEnv.github,
      betterAuth,
      betterAuthInstance: auth,
    });

    let ready: Promise<unknown> | undefined;
    const app = new Hono();
    app.use('*', async (c, next) => {
      // Short wait: while another instance holds the lease, answer 503 fast
      // rather than hold the request open.
      ready ??= prepareDatabase(db, auth, { waitMs: PREPARE_WAIT_MS }).catch((err: unknown) => {
        ready = undefined; // the next request retries
        throw err;
      });
      try {
        await ready;
      } catch (err) {
        if (!(err instanceof SchemaDriftError)) throw err;
        return c.json({ error: 'schema_behind', schema: err.summary }, 503);
      }
      await next();
    });
    app.mount('/', inner.fetch);
    return app;
  } catch (err) {
    if (hostedMisconfigResponse(err) === undefined) throw err;
    return new Hono().all('*', () => hostedMisconfigResponse(err) as Response);
  }
}
