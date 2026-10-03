/**
 * Cloudflare Workers entry. Non-API paths go to the built SPA (wrangler
 * [assets]); /api and /mcp go to the shared hosted app.
 */
import { createWebDb } from '@plandesk/db/web';
import type { R2BucketLike } from '@plandesk/api';
import { createHostedApp } from './hosted-app.js';

type Env = {
  FILES?: R2BucketLike;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  [name: string]: unknown;
};

const API_PATH = /^\/(api|mcp)(\/|$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!API_PATH.test(url.pathname) && env.ASSETS !== undefined) {
      return env.ASSETS.fetch(request);
    }
    const app = await createHostedApp(env, {
      openDb: createWebDb,
      files: env.FILES,
      requestOrigin: url.origin,
    });
    return app.fetch(request);
  },
};
