import { Hono } from 'hono';

/**
 * `dataDir` is the Node-local topology's board path — omitted for edge/remote
 * deployments that have no local data dir. Callers use it to verify a served
 * board's identity, not just that the port answers (REQ-A3).
 */
export function createHealthRouter(dataDir?: string): Hono {
  const router = new Hono();
  router.get('/health', (c) =>
    c.json(dataDir !== undefined ? { ok: true, dataDir } : { ok: true }),
  );
  return router;
}

export const healthRouter = createHealthRouter();
