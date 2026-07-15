import { describe, expect, it } from 'vitest';
import { createDb, migrate } from '@plandesk/db';
import { createApp } from './server.js';
import { createBetterAuth, runBetterAuthMigrations } from './better-auth.js';
import { createTestApp } from './test-helpers.js';

// Not a real credential — a fixture secret for constructing better-auth in tests.
const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

describe('better-auth foundation (slice 1/6)', () => {
  it('creates its 9 tables on the same libSQL db as our drizzle schema (REQ-3, REQ-4)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);

    const auth = createBetterAuth({ client: db.$client, secret: TEST_SECRET, baseURL: TEST_BASE_URL });
    if (auth === undefined) {
      throw new Error('expected createBetterAuth to return an instance when a secret is configured');
    }
    await runBetterAuthMigrations(auth);

    const result = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'organization', 'user', 'session', 'account', 'verification', 'member', 'invitation', 'apikey', 'deviceCode')",
    );
    const names = new Set(result.rows.map((row) => String(row.name)));

    // Ours (drizzle, one of our 16 migrations).
    expect(names.has('tasks')).toBe(true);
    // better-auth's own 9 tables, created by its runtime Kysely migrator — no
    // Drizzle migration file, no drizzle-kit involvement, no shared ledger.
    for (const table of [
      'user',
      'session',
      'account',
      'verification',
      'organization',
      'member',
      'invitation',
      'apikey',
      'deviceCode',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('createApp boots and an existing route behaves identically with better-auth mounted (REQ-6)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);

    const withoutBetterAuth = createApp({ db });
    const withBetterAuth = createApp({ db, betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL } });

    for (const app of [withoutBetterAuth, withBetterAuth]) {
      const health = await app.request('/api/v1/health');
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const unknown = await app.request('/api/v1/unknown');
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'not_found' });
    }
  });

  it('boots with no better-auth secret configured — feature absent, no crash (REQ-5)', async () => {
    const { app } = await createTestApp();

    // Mirrors github: undefined — the route simply doesn't exist.
    const res = await app.request('/api/auth/session');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
