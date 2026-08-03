import type { Db } from '@plandesk/db';
import { getSchemaMigrationSummary } from '@plandesk/db';
import { Hono } from 'hono';

/**
 * `dataDir` is the Node-local topology's board path — omitted for edge/remote
 * deployments that have no local data dir. Callers use it to verify a served
 * board's identity, not just that the port answers (REQ-A3).
 */
export function createHealthRouter(dataDir?: string, db?: Db): Hono {
  const router = new Hono();
  router.get('/health', async (c) => {
    const body: Record<string, unknown> = { ok: true };
    if (dataDir !== undefined) {
      body.dataDir = dataDir;
    }
    if (db !== undefined) {
      body.schema = await getSchemaMigrationSummary(db);
    }
    return c.json(body);
  });
  return router;
}

export const healthRouter = createHealthRouter();
