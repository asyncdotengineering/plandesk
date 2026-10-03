/**
 * Vercel entry for the Plan Desk API.
 * Same Hono app as Node/Workers — config from `readServerEnv(process.env)`.
 * SPA is served by the Vercel deployment’s static assets, not mountStatic.
 */
import { handle } from 'hono/vercel';
import { createDb } from '@plandesk/db';
import type { Hono } from 'hono';
import { createApp } from './server.js';
import { createServices } from './services/index.js';
import { createStorageAdapter } from './storage/index.js';
import { createBetterAuth } from './better-auth.js';
import { hostedMisconfigResponse, resolveHostedBetterAuth } from './hosted-auth.js';
import { readServerEnv } from './read-server-env.js';

let appPromise: Promise<Hono> | undefined;

function vercelBaseUrlFallback(): string | undefined {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl === undefined || vercelUrl.trim() === '') return undefined;
  // Vercel provides host only; production traffic is HTTPS.
  return `https://${vercelUrl.trim()}`;
}

async function getApp(): Promise<Hono> {
  if (appPromise !== undefined) {
    return appPromise;
  }
  appPromise = (async () => {
    const env = readServerEnv(process.env);
    if (env.dbUrl === undefined) {
      throw new Error('PLANDESK_DB_URL is required for the Vercel entry');
    }

    // Construction-time only — no Request; baseURL from env (or VERCEL_URL).
    const betterAuth = resolveHostedBetterAuth({
      authSecret: env.authSecret,
      baseUrl: env.baseUrl ?? vercelBaseUrlFallback(),
    });

    const db = await createDb(env.dbUrl, env.dbToken);
    const auth = createBetterAuth({
      client: db.$client,
      db,
      secret: betterAuth.secret,
      baseURL: betterAuth.baseURL,
      github: env.github,
    });
    const storage = createStorageAdapter({ db, storage: env.storage });
    const services = createServices({ db, auth, storage });
    return createApp({
      db,
      services,
      authPassword: env.authPassword,
      bindHost: '0.0.0.0',
      github: env.github,
      betterAuth,
    });
  })();
  return appPromise;
}

const handler = async (req: Request): Promise<Response> => {
  try {
    const app = await getApp();
    return await handle(app)(req);
  } catch (err) {
    const misconfig = hostedMisconfigResponse(err);
    if (misconfig !== undefined) return misconfig;
    throw err;
  }
};

export default handler;
