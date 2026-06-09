#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { createSyncServer } from './app.js';
import { seedSyncToken } from './auth.js';
import { createSyncDb } from './db/client.js';
import { migrate } from './db/migrate.js';

const port = Number(process.env['PORT'] ?? 3848);
const dbPath = process.env['SYNC_DB_PATH'] ?? './sync.db';

const db = createSyncDb(dbPath);
await migrate(db);

const bootstrapToken = process.env['SYNC_BOOTSTRAP_TOKEN'];
if (bootstrapToken !== undefined && bootstrapToken.trim() !== '') {
  const seeded = await seedSyncToken(db, bootstrapToken.trim());
  console.log(
    seeded
      ? 'Seeded owner sync token from SYNC_BOOTSTRAP_TOKEN.'
      : 'Owner sync token already present.',
  );
}

serve({ fetch: createSyncServer({ db }).fetch, port }, (info) => {
  console.log(
    `@plandesk/sync-server listening on http://localhost:${String(info.port)} (db: ${dbPath})`,
  );
});
