import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '@plandesk/db';
import {
  createBetterAuth,
  ensureLocalBetterAuthOrganization,
  ensureShellOwner,
  type R2BucketLike,
} from '@plandesk/api';
import { createHostedApp } from './hosted-app.js';

const SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const BASE = 'https://plandesk.test';
const LEASE_DDL =
  'CREATE TABLE IF NOT EXISTS __plandesk_lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL)';
const S3_ENV = {
  PLANDESK_STORAGE: 's3',
  PLANDESK_S3_BUCKET: 'smoke-bucket',
  PLANDESK_S3_REGION: 'auto',
  PLANDESK_S3_ACCESS_KEY_ID: 'AKIDTEST',
  PLANDESK_S3_SECRET_ACCESS_KEY: 'not-a-real-secret',
  PLANDESK_S3_ENDPOINT: 'https://s3.storage.test',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A fresh env object per call: createHostedApp memoises by env identity. */
function env(extra: Record<string, string> = {}): Record<string, unknown> {
  return {
    PLANDESK_DB_URL: 'libsql://hosted.test',
    PLANDESK_BETTER_AUTH_SECRET: SECRET,
    PLANDESK_BASE_URL: BASE,
    ...extra,
  };
}

/** The session `plandesk login` would exchange: the shell owner of the board's org. */
async function ownerHeaders(db: Db): Promise<Record<string, string>> {
  const auth = createBetterAuth({ client: db.$client, db, secret: SECRET, baseURL: BASE });
  if (auth === undefined) throw new Error('expected better-auth');
  const org = await ensureLocalBetterAuthOrganization(db, auth);
  const { headers } = await ensureShellOwner(auth, org.id);
  return { cookie: headers.get('cookie') ?? '', origin: BASE };
}

async function uploadOne(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  db: Db,
): Promise<{ id: string }> {
  expect((await app.request(`${BASE}/api/v1/health`)).status).toBe(200);
  const headers = { ...(await ownerHeaders(db)), 'content-type': 'application/json' };
  const project = await app.request(`${BASE}/api/v1/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Storage precedence' }),
  });
  expect(project.status).toBe(201);
  const { id: projectId } = (await project.json()) as { id: string };
  const up = await app.request(`${BASE}/api/v1/projects/${projectId}/files`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: 'a.bin',
      mime: 'application/octet-stream',
      content_base64: Buffer.from('precedence').toString('base64'),
    }),
  });
  expect(up.status).toBe(201);
  return (await up.json()) as { id: string };
}

function fakeBucket(): R2BucketLike & { keys: string[] } {
  const objects = new Map<string, ArrayBuffer>();
  return {
    get keys() {
      return [...objects.keys()];
    },
    async put(key, value) {
      objects.set(key, await new Response(value as BodyInit).arrayBuffer());
      return {};
    },
    get(key) {
      const bytes = objects.get(key);
      return Promise.resolve(
        bytes === undefined ? null : { arrayBuffer: () => Promise.resolve(bytes) },
      );
    },
    head(key) {
      return Promise.resolve(objects.has(key) ? {} : null);
    },
  };
}

describe('createHostedApp', () => {
  /**
   * REGRESSION: the hosted entries shipped without an MCP app (Workers through
   * the 1.0 line, Vercel until this package existed). An authenticated
   * initialize is the discriminating check: unauthenticated probes 401 before
   * routing whether or not /mcp is mounted.
   */
  it('serves MCP to an authenticated agent', async () => {
    const db = await createDb(':memory:');
    const app = await createHostedApp(env(), { openDb: () => Promise.resolve(db) });
    expect((await app.request(`${BASE}/api/v1/health`)).status).toBe(200);
    const res = await app.request(`${BASE}/mcp/`, {
      method: 'POST',
      headers: {
        ...(await ownerHeaders(db)),
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
          clientInfo: { name: 'hosted-app-test', version: '1' },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it('prepares a fresh database on first use: health reports a current schema', async () => {
    const db = await createDb(':memory:');
    const app = await createHostedApp(env(), { openDb: () => Promise.resolve(db) });
    const res = await app.request(`${BASE}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { schema: { current: boolean } }).schema.current).toBe(true);
  });

  it('answers 503 schema_behind on /api and /mcp while another instance holds the lease, then retries', async () => {
    const db = await createDb(':memory:');
    await db.$client.execute(LEASE_DDL);
    await db.$client.execute({
      sql: 'INSERT INTO __plandesk_lease (id, holder, expires_at) VALUES (1, ?, ?)',
      args: ['other-instance', Date.now() + 10 * 60_000],
    });
    const app = await createHostedApp(env(), { openDb: () => Promise.resolve(db) });

    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const pending = Promise.all([
      app.request(`${BASE}/api/v1/projects`),
      app.request(`${BASE}/mcp/`, { method: 'POST' }),
      app.request(`${BASE}/api/v1/health`),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    const responses = await pending;
    vi.useRealTimers();

    for (const res of responses) {
      expect(res.status).toBe(503);
      // Same body as `plandesk serve` (Docker) and the `schema` key /health uses.
      const body = (await res.json()) as {
        error: string;
        schema: { current: boolean; missingTags: string[] };
      };
      expect(body.error).toBe('schema_behind');
      expect(body.schema.current).toBe(false);
      expect(body.schema.missingTags.length).toBeGreaterThan(0);
    }

    // The other instance goes away: the next request prepares instead of
    // replaying the failure.
    await db.$client.execute('DELETE FROM __plandesk_lease');
    const health = await app.request(`${BASE}/api/v1/health`);
    expect(health.status).toBe(200);
  });

  it('answers misconfigured JSON 500 for a bad env instead of throwing', async () => {
    const bad: Record<string, string>[] = [
      { PLANDESK_BETTER_AUTH_SECRET: '', PLANDESK_SESSION_SECRET: SECRET },
      { PLANDESK_S3_BUCKET: 'stray' },
      { PLANDESK_DB_URL: '' },
      { PLANDESK_BETTER_AUTH_SECRET: '' },
    ];
    for (const extra of bad) {
      const app = await createHostedApp(env(extra), {
        openDb: () => createDb(':memory:'),
      });
      const res = await app.request(`${BASE}/api/v1/health`);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('misconfigured');
      expect(body.message).toMatch(/PLANDESK_/);
    }
  });

  describe('storage precedence: R2 binding > S3 config > database', () => {
    it('writes to the R2 binding even when S3 is configured', async () => {
      const db = await createDb(':memory:');
      const bucket = fakeBucket();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const app = await createHostedApp(env(S3_ENV), {
        openDb: () => Promise.resolve(db),
        files: bucket,
      });
      await uploadOne(app, db);
      expect(bucket.keys).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('writes to S3 when configured and no R2 binding is present', async () => {
      const db = await createDb(':memory:');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
      const app = await createHostedApp(env(S3_ENV), { openDb: () => Promise.resolve(db) });
      await uploadOne(app, db);
      const urls = fetchSpy.mock.calls.map(([input]) =>
        input instanceof Request ? input.url : String(input),
      );
      expect(urls.some((url) => url.startsWith('https://s3.storage.test/smoke-bucket/'))).toBe(
        true,
      );
    });

    it('keeps bytes in the database with neither', async () => {
      const db = await createDb(':memory:');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const app = await createHostedApp(env(), { openDb: () => Promise.resolve(db) });
      const file = await uploadOne(app, db);
      expect(fetchSpy).not.toHaveBeenCalled();
      const down = await app.request(`${BASE}/api/v1/files/${file.id}`, {
        headers: await ownerHeaders(db),
      });
      expect(Buffer.from(await down.arrayBuffer()).toString()).toBe('precedence');
    });
  });
});
