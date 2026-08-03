import { createDb, migrate } from '@plandesk/db';
import { describe, expect, it } from 'vitest';
import { createHealthRouter, healthRouter } from './health.js';

describe('createHealthRouter', () => {
  it('reports ok with no dataDir when none is configured (edge/remote topologies)', async () => {
    const res = await healthRouter.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('includes the resolved dataDir when configured (REQ-A3a)', async () => {
    const router = createHealthRouter('/tmp/some-board');
    const res = await router.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dataDir: '/tmp/some-board' });
  });

  it('includes schema migration summary when a database is wired', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const router = createHealthRouter('/tmp/some-board', db);
    const res = await router.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      dataDir?: string;
      schema?: { current: boolean; missingTags: string[]; applied: number; shipped: number };
    };
    expect(body).toMatchObject({ ok: true, dataDir: '/tmp/some-board' });
    expect(body.schema).toMatchObject({
      current: true,
      missingTags: [],
    });
    expect(body.schema?.applied).toBeGreaterThan(0);
    expect(body.schema?.shipped).toBe(body.schema?.applied);
  });
});
