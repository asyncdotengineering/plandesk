import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb } from '@plandesk/db';
import {
  createBetterAuth,
  ensureLocalBetterAuthOrganization,
  ensureShellOwner,
} from '@plandesk/api';

const SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const BASE = 'https://vercel.plandesk.test';
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'plandesk-vercel-'));
  vi.stubEnv('PLANDESK_DB_URL', join(dir, 'board.db'));
  vi.stubEnv('PLANDESK_BETTER_AUTH_SECRET', SECRET);
  vi.stubEnv('PLANDESK_BASE_URL', BASE);
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('Vercel entry', () => {
  /**
   * REGRESSION: the Vercel entry lived in @plandesk/api, which cannot import
   * @plandesk/mcp, so it never served /mcp/. Authenticated, because an
   * unauthenticated probe 401s before routing whether /mcp is mounted or not.
   */
  it('serves MCP from the default-exported handler', async () => {
    const { default: handler } = await import('./vercel.js');
    expect((await handler(new Request(`${BASE}/api/v1/health`))).status).toBe(200);

    const db = await createDb(process.env.PLANDESK_DB_URL ?? '');
    const auth = createBetterAuth({ client: db.$client, db, secret: SECRET, baseURL: BASE });
    if (auth === undefined) throw new Error('expected better-auth');
    const org = await ensureLocalBetterAuthOrganization(db, auth);
    const { headers } = await ensureShellOwner(auth, org.id);

    const res = await handler(
      new Request(`${BASE}/mcp/`, {
        method: 'POST',
        headers: {
          cookie: headers.get('cookie') ?? '',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'vercel-test', version: '1' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
