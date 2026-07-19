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
  createR2Adapter,
  createS3Adapter,
  createServices,
  githubConfigFromEnv,
  hostedMisconfigResponse,
  resolveHostedBetterAuth,
  type BetterAuthInstance,
  type S3AdapterConfig,
} from '@plandesk/api';
import { createMcpApp } from '@plandesk/mcp';

export interface Env {
  /** Turso/libSQL URL — set via `wrangler secret put PLANDESK_DB_URL` */
  PLANDESK_DB_URL: string;
  /** Turso/libSQL auth token — set via `wrangler secret put PLANDESK_DB_TOKEN` */
  PLANDESK_DB_TOKEN: string;
  PLANDESK_S3_BUCKET?: string;
  PLANDESK_S3_REGION?: string;
  PLANDESK_S3_ACCESS_KEY_ID?: string;
  PLANDESK_S3_SECRET_ACCESS_KEY?: string;
  PLANDESK_S3_ENDPOINT?: string;
  PLANDESK_AUTH_PASSWORD?: string;
  /**
   * better-auth secret (sessions + API keys). Required on this non-loopback entry.
   * `wrangler secret put PLANDESK_BETTER_AUTH_SECRET`
   */
  PLANDESK_BETTER_AUTH_SECRET?: string;
  /**
   * Public deploy origin (e.g. https://plandesk-api.example.workers.dev).
   * better-auth baseURL for OAuth callbacks + cookies. Prefer setting this;
   * falls back to the request URL origin when unset.
   */
  PLANDESK_BASE_URL?: string;
  /** GitHub app for browser sign-in. Unset → no GitHub sign-in (REQ-20). */
  PLANDESK_GITHUB_CLIENT_ID?: string;
  /** `wrangler secret put PLANDESK_GITHUB_CLIENT_SECRET` — never a build-time value. */
  PLANDESK_GITHUB_CLIENT_SECRET?: string;
  /**
   * Legacy / githubConfigFromEnv gate: all-or-nothing with client id+secret.
   * better-auth itself derives the OAuth callback from PLANDESK_BASE_URL
   * (`{baseURL}/api/auth/callback/github`) and does not read this value.
   * Set it to the same better-auth callback URL so githubEnabled is true.
   */
  PLANDESK_GITHUB_CALLBACK_URL?: string;
  PLANDESK_DASHBOARD_URL?: string;
  /** R2 bucket for file blobs (native Workers binding — preferred over S3 creds). */
  FILES?: R2Bucket;
  /** Built web SPA (wrangler [assets]). */
  ASSETS?: Fetcher;
}

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

function s3ConfigFromEnv(env: Env): S3AdapterConfig | undefined {
  const bucket = env.PLANDESK_S3_BUCKET;
  const region = env.PLANDESK_S3_REGION;
  const accessKeyId = env.PLANDESK_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.PLANDESK_S3_SECRET_ACCESS_KEY;
  if (
    bucket === undefined ||
    bucket === '' ||
    region === undefined ||
    region === '' ||
    accessKeyId === undefined ||
    accessKeyId === '' ||
    secretAccessKey === undefined ||
    secretAccessKey === ''
  ) {
    return undefined;
  }
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint: env.PLANDESK_S3_ENDPOINT,
  };
}

function resolveWorkerStorage(env: Env, db: Db) {
  // Prefer the native R2 binding over S3 credentials when present.
  if (env.FILES !== undefined) {
    return createR2Adapter({ db, bucket: env.FILES });
  }
  const s3 = s3ConfigFromEnv(env);
  if (s3 !== undefined) {
    return createS3Adapter({ db, config: s3 });
  }
  return undefined;
}

async function getDb(env: Env): Promise<Db> {
  const key = `${env.PLANDESK_DB_URL}\0${env.PLANDESK_DB_TOKEN}`;
  if (cache !== undefined && cache.key === key) {
    return cache.db;
  }
  const db = await createWebDb(env.PLANDESK_DB_URL, env.PLANDESK_DB_TOKEN);
  cache = { key, db };
  return db;
}

async function getBetterAuth(
  env: Env,
  db: Db,
  config: { secret: string; baseURL: string },
): Promise<BetterAuthInstance> {
  const key = [
    env.PLANDESK_DB_URL,
    env.PLANDESK_DB_TOKEN,
    config.secret,
    config.baseURL,
    env.PLANDESK_GITHUB_CLIENT_ID ?? '',
    env.PLANDESK_GITHUB_CLIENT_SECRET ?? '',
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
    github: githubConfigFromEnv(env),
  });
  if (auth === undefined) {
    throw new Error('Hosted better-auth instance could not be created');
  }
  authCache = { key, auth };
  return auth;
}

function isApiOrMcpPath(pathname: string): boolean {
  return pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/');
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
  github?: ReturnType<typeof githubConfigFromEnv>;
  betterAuth: { secret: string; baseURL: string };
  betterAuthInstance: BetterAuthInstance;
}) {
  // The MCP app is stateless (WebStandardStreamableHTTPServerTransport with
  // sessionIdGenerator: undefined), so it needs no per-request session store
  // and runs fine on a Worker isolate.
  return createApp({
    db: deps.db,
    services: deps.services,
    mcp: createMcpApp({ services: deps.services }),
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

    let betterAuth: { secret: string; baseURL: string };
    try {
      betterAuth = resolveHostedBetterAuth(env, url.origin);
    } catch (err) {
      const misconfig = hostedMisconfigResponse(err);
      if (misconfig !== undefined) return misconfig;
      throw err;
    }

    const db = await getDb(env);
    const authInstance = await getBetterAuth(env, db, betterAuth);
    // Storage is optional: prefer R2 binding, then S3 creds, else unavailable
    // (file uploads/artifacts off — no crash). Mirrors `plandesk serve`.
    const storage = resolveWorkerStorage(env, db);
    const services = createServices({ db, auth: authInstance, ...(storage !== undefined ? { storage } : {}) });
    const app = composeWorkerApp({
      db,
      services,
      authPassword: env.PLANDESK_AUTH_PASSWORD,
      github: githubConfigFromEnv(env),
      betterAuth,
      betterAuthInstance: authInstance,
    });

    return app.fetch(request, env, ctx);
  },
};
