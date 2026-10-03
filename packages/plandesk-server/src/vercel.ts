/**
 * Vercel entry: a fetch-style handler over the shared hosted app. The SPA is
 * served from the deployment's static output, not from here.
 */
import { createDb } from '@plandesk/db';
import { createHostedApp } from './hosted-app.js';

export default async function handler(request: Request): Promise<Response> {
  // PLANDESK_BASE_URL wins inside createHostedApp. Otherwise prefer the
  // production domain: VERCEL_URL is the per-deployment hash host, so cookies
  // and OAuth callbacks would point at a URL nobody opens. Host only; HTTPS.
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const app = await createHostedApp(process.env, {
    openDb: createDb,
    requestOrigin: productionHost ? `https://${productionHost}` : new URL(request.url).origin,
  });
  return app.fetch(request);
}
