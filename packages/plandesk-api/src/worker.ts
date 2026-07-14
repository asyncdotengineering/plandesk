/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Workers entry for the Plan Desk API.
 * Same Hono app as Node/Vercel — only wiring (db client, storage config, assets) differs.
 * Never migrates. Never imports static.ts / node:fs SPA helpers.
 */
import { createWebDb } from '@plandesk/db/web';
import type { Db } from '@plandesk/db';
import { createApp } from './server.js';
import { createServices } from './services/index.js';
import { githubConfigFromEnv } from './github.js';
import { createS3Adapter, type S3AdapterConfig } from './storage/s3.js';

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
  /** GitHub app for browser sign-in. Unset → no GitHub sign-in (REQ-20). */
  PLANDESK_GITHUB_CLIENT_ID?: string;
  /** `wrangler secret put PLANDESK_GITHUB_CLIENT_SECRET` — never a build-time value. */
  PLANDESK_GITHUB_CLIENT_SECRET?: string;
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

let cache: Cached | undefined;

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

    const db = await getDb(env);
    const storage = createS3Adapter({ db, config: s3ConfigFromEnv(env) });
    const services = createServices({ db, storage });
    const app = createApp({
      db,
      services,
      authPassword: env.PLANDESK_AUTH_PASSWORD,
      // Non-loopback: hosted path requires a token or a session (no default-org trust).
      bindHost: '0.0.0.0',
      github: githubConfigFromEnv(env),
    });

    return app.fetch(request, env, ctx);
  },
};
