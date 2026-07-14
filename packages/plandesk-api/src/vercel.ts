/**
 * Vercel entry for the Plan Desk API.
 * Same Hono app as Node/Workers — config (Turso URL/token, storage) from process.env.
 * SPA is served by the Vercel deployment’s static assets, not mountStatic.
 */
import { handle } from 'hono/vercel';
import { createDb } from '@plandesk/db';
import type { Hono } from 'hono';
import { createApp } from './server.js';
import { createServices } from './services/index.js';
import { createStorageAdapter } from './storage/index.js';

let appPromise: Promise<Hono> | undefined;

async function getApp(): Promise<Hono> {
  if (appPromise !== undefined) {
    return appPromise;
  }
  appPromise = (async () => {
    const url = process.env.PLANDESK_DB_URL;
    if (url === undefined || url.length === 0) {
      throw new Error('PLANDESK_DB_URL is required for the Vercel entry');
    }
    const db = await createDb(url, process.env.PLANDESK_DB_TOKEN);
    // Select s3 via PLANDESK_STORAGE=s3 (+ S3_* env); local remains default when unset.
    const storage = createStorageAdapter({ db, env: process.env });
    const services = createServices({ db, storage });
    return createApp({
      db,
      services,
      authPassword: process.env.PLANDESK_AUTH_PASSWORD,
      bindHost: '0.0.0.0',
    });
  })();
  return appPromise;
}

const handler = async (req: Request): Promise<Response> => {
  const app = await getApp();
  return handle(app)(req);
};

export default handler;
