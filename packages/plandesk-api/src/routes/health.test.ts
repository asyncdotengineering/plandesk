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
});
