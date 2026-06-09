import { serve } from '@hono/node-server';
import { createSyncServer } from './app.js';
import { createSyncDb } from './db/client.js';
import { migrate } from './db/migrate.js';

const port = Number(process.env['PORT'] ?? 3848);
const dbPath = process.env['SYNC_DB_PATH'] ?? './sync.db';

const db = createSyncDb(dbPath);
await migrate(db);

serve({ fetch: createSyncServer({ db }).fetch, port });
