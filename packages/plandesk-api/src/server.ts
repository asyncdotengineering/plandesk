import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { healthRouter } from './routes/health.js';
import { mountStatic } from './static.js';

export type AppDeps = {
  db: Db;
};

export function createApp(deps: AppDeps): Hono {
  void deps.db;
  const app = new Hono();

  app.route('/api/v1', healthRouter);
  mountStatic(app);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
