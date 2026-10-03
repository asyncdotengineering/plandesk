/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Workers entry for Plan Desk — the deployment composition root.
 *
 * This package exists so the hosted entry can wire the API app together with
 * the MCP app. `@plandesk/mcp` imports runtime values from `@plandesk/api`
 * (tryGetAuthContext, the Invalid*Error classes), so `api` cannot import `mcp`
 * back without a dependency cycle — the same reason the CLI's `serve` is the
 * composition root on Node. Both apps are composed here instead.
 *
 * Same Hono app as Node/Vercel — only wiring (db client, storage, assets)
 * differs. Never migrates. Never imports static.ts / node:fs SPA helpers.
 */
import { createWebDb } from '@plandesk/db/web';
import type { Db } from '@plandesk/db';
import {
  createApp,
  createBetterAuth,
  createServices,
  createStorageAdapter,
  hostedMisconfigResponse,
  readServerEnv,
  resolveHostedBetterAuth,
  type BetterAuthInstance,
  type GithubConfig,
  type ServerEnv,
} from '@plandesk/api';
import { createMcpApp } from '@plandesk/mcp';

/**
 * Worker bindings. Every `PLANDESK_*` var (see wrangler.toml) is read through
 * `readServerEnv`; only the platform bindings are named here.
 */
export type Env = {
  /** R2 bucket for file blobs (native Workers binding — wins over PLANDESK_STORAGE). */
  FILES?: R2Bucket;
  /** Built web SPA (wrangler [assets]). */
  ASSETS?: Fetcher;
  [name: string]: unknown;
};

type Cached = {
  key: string;
  db: Db;
};

type CachedAuth = {
  key: string;
  auth: BetterAuthInstance;
};

let cache: Cached | undefined;
let authCache: CachedAuth | undefined;

async function getDb(dbUrl: string, dbToken: string | undefined): Promise<Db> {
  const key = `${dbUrl}\0${dbToken ?? ''}`;
  if (cache !== undefined && cache.key === key) {
    return cache.db;
  }
  const db = await createWebDb(dbUrl, dbToken);
  cache = { key, db };
  return db;
}

function getBetterAuth(
  env: ServerEnv,
  db: Db,
  config: { secret: string; baseURL: string },
): BetterAuthInstance {
  const key = [
    env.dbUrl ?? '',
    env.dbToken ?? '',
    config.secret,
    config.baseURL,
    env.github?.clientId ?? '',
    env.github?.clientSecret ?? '',
  ].join('\0');
  if (authCache !== undefined && authCache.key === key) {
    return authCache.auth;
  }
  // The instance holds immutable plugin/configuration state; each handler call
  // receives its own request context, so reuse cannot leak auth between requests.
  const auth = createBetterAuth({
    client: db.$client,
    db,
    secret: config.secret,
    baseURL: config.baseURL,
    github: env.github,
  });
  if (auth === undefined) {
    throw new Error('Hosted better-auth instance could not be created');
  }
  authCache = { key, auth };
  return auth;
}

function isApiOrMcpPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/')
  );
}

/**
 * The whole reason this package exists: compose the API app WITH the MCP app.
 * Exported so a test can assert /mcp is actually mounted — the hosted entry
 * shipped without it for the entire 1.0 line precisely because nothing checked.
 */
export function composeWorkerApp(deps: {
  db: Db;
  services: ReturnType<typeof createServices>;
  authPassword?: string;
  github?: GithubConfig;
  betterAuth: { secret: string; baseURL: string };
  betterAuthInstance: BetterAuthInstance;
}) {
  // The MCP app is stateless (WebStandardStreamableHTTPServerTransport with
  // sessionIdGenerator: undefined), so it needs no per-request session store
  // and runs fine on a Worker isolate.
  return createApp({
    db: deps.db,
    services: deps.services,
    mcp: createMcpApp({ services: deps.services, bindHost: '0.0.0.0' }),
    authPassword: deps.authPassword,
    // Non-loopback: hosted path requires a token or a session (no default-org trust).
    bindHost: '0.0.0.0',
    github: deps.github,
    betterAuth: deps.betterAuth,
    betterAuthInstance: deps.betterAuthInstance,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Non-API traffic → platform asset binding (SPA). Node uses mountStatic instead.
    if (!isApiOrMcpPath(url.pathname) && env.ASSETS !== undefined) {
      return env.ASSETS.fetch(request);
    }

    const serverEnv = readServerEnv(env);
    if (serverEnv.dbUrl === undefined) {
      throw new Error('PLANDESK_DB_URL is required for the Workers entry');
    }

    let betterAuth: { secret: string; baseURL: string };
    try {
      betterAuth = resolveHostedBetterAuth(serverEnv, url.origin);
    } catch (err) {
      const misconfig = hostedMisconfigResponse(err);
      if (misconfig !== undefined) return misconfig;
      throw err;
    }

    const db = await getDb(serverEnv.dbUrl, serverEnv.dbToken);
    const authInstance = getBetterAuth(serverEnv, db, betterAuth);
    // R2 binding wins; otherwise PLANDESK_STORAGE (s3), else bytes in the database.
    const storage = createStorageAdapter({ db, storage: serverEnv.storage, r2: env.FILES });
    const services = createServices({ db, auth: authInstance, storage });
    const app = composeWorkerApp({
      db,
      services,
      authPassword: serverEnv.authPassword,
      github: serverEnv.github,
      betterAuth,
      betterAuthInstance: authInstance,
    });

    return app.fetch(request, env, ctx);
  },
};
