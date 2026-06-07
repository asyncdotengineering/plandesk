import { describe, expect, it } from 'vitest';
import { createDb } from '@plandesk/db';
import { createApp } from './server.js';

describe('createApp', () => {
  it('returns ok from GET /api/v1/health', async () => {
    const db = createDb(':memory:');
    const app = createApp({ db });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 404 for unknown API paths', async () => {
    const db = createDb(':memory:');
    const app = createApp({ db });
    const res = await app.request('/api/v1/unknown');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
