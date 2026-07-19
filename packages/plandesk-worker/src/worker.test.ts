import { describe, expect, it } from 'vitest';
import { createDb, migrate } from '@plandesk/db';
import { createBetterAuth, createServices, runBetterAuthMigrations } from '@plandesk/api';
import { composeWorkerApp } from './worker.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'https://plandesk.test';

async function composeForTest() {
  const db = await createDb(':memory:');
  await migrate(db);
  const auth = createBetterAuth({
    client: db.$client,
    db,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);
  const services = createServices({ db, auth });
  return composeWorkerApp({
    db,
    services,
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    betterAuthInstance: auth,
  });
}

describe('hosted worker composition', () => {
  /**
   * REGRESSION: the hosted entry shipped through the entire 1.0 line without an
   * MCP app, so `connect --to <org>` wrote an .mcp.json pointing at a URL that
   * could not serve tools. `api` cannot import `mcp` (mcp imports runtime values
   * back from api), which is why this composition lives in its own package.
   */
  it('mounts the MCP app so hosted agents can reach /mcp', async () => {
    const app = await composeForTest();
    const mcpRoutes = app.routes.filter((route) => route.path.startsWith('/mcp'));
    expect(mcpRoutes.length).toBeGreaterThan(0);
  });

  it('still mounts the API routes alongside it', async () => {
    const app = await composeForTest();
    expect(app.routes.some((route) => route.path.startsWith('/api'))).toBe(true);
  });
});

// Deliberately NOT tested here: an unauthenticated POST /mcp/ returning
// non-404. Hosted auth rejects with 401 *before* routing, so that assertion
// passes even when the MCP app is absent — it looks like end-to-end proof and
// discriminates nothing. The route-mounting assertion above is the real guard
// (verified by removing the wiring and watching it fail).
