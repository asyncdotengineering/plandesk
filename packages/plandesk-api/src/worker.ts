/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Workers entry for the Plan Desk API.
 * Same Hono app as Node/Vercel — only wiring (db client, storage config, assets) differs.
 * Never migrates. Never imports static.ts / node:fs SPA helpers.
 */
import { createWebDb } from '@plandesk/db/web';
import type { Db } from '@plandesk/db';
import { createApp } from './server.js';
import { createBetterAuth, type BetterAuthInstance } from './better-auth.js';
import { createServices } from './services/index.js';
import { githubConfigFromEnv } from './github.js';
import { createS3Adapter, type S3AdapterConfig } from './storage/s3.js';
import { hostedMisconfigResponse, resolveHostedBetterAuth } from './hosted-auth.js';

export interface Env {
  /** Turso/libSQL URL — set via `wrangler secret put PLANDESK_DB_URL` */
  PLANDESK_DB_URL: string;
  /** Turso/libSQL auth token — set via `wrangler secret put PLANDESK_DB_TOKEN` */
  PLANDESK_DB_TOKEN: string;
  PLANDESK_S3_BUCKET: string;
  PLANDESK_S3_REGION: string;
  PLANDESK_S3_ACCESS_KEY_ID: string;
  PLANDESK_S3_SECRET_ACCESS_KEY: string;
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
  /** R2 bucket for file blobs (S3-compatible credentials above target this bucket). */
  FILES: R2Bucket;
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

function s3ConfigFromEnv(env: Env): S3AdapterConfig {
  return {
    bucket: env.PLANDESK_S3_BUCKET,
    region: env.PLANDESK_S3_REGION,
    accessKeyId: env.PLANDESK_S3_ACCESS_KEY_ID,
    secretAccessKey: env.PLANDESK_S3_SECRET_ACCESS_KEY,
    endpoint: env.PLANDESK_S3_ENDPOINT,
  };
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
    const storage = createS3Adapter({ db, config: s3ConfigFromEnv(env) });
    const services = createServices({ db, storage });
    const app = createApp({
      db,
      services,
      authPassword: env.PLANDESK_AUTH_PASSWORD,
      // Non-loopback: hosted path requires a token or a session (no default-org trust).
      bindHost: '0.0.0.0',
      github: githubConfigFromEnv(env),
      betterAuth,
      betterAuthInstance: authInstance,
    });

    return app.fetch(request, env, ctx);
  },
};
