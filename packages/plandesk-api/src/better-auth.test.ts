import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, migrate } from '@plandesk/db';
import { createApp } from './server.js';
import { createBetterAuth, runBetterAuthMigrations } from './better-auth.js';

// Not a real credential — a fixture secret for constructing better-auth in tests.
const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

type BetterAuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BetterAuthAccount = {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  password: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stringColumn(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected string database column');
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('better-auth foundation (slice 1/6)', () => {
  it('creates its tables on the same libSQL db as our drizzle schema (REQ-3, REQ-4)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);

    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) {
      throw new Error(
        'expected createBetterAuth to return an instance when a secret is configured',
      );
    }
    await runBetterAuthMigrations(auth);

    const result = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'organization', 'user', 'session', 'account', 'verification', 'member', 'invitation', 'apikey')",
    );
    const names = new Set(result.rows.map((row) => stringColumn(row.name)));

    // Ours (drizzle, one of our 16 migrations).
    expect(names.has('tasks')).toBe(true);
    // better-auth's own tables, created by its runtime Kysely migrator — no
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
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('createApp boots and an existing route behaves identically with better-auth mounted (REQ-6)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);

    const withoutBetterAuth = createApp({ db });
    const withBetterAuth = createApp({
      db,
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    });

    for (const app of [withoutBetterAuth, withBetterAuth]) {
      const health = await app.request('/api/v1/health');
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as {
        ok: boolean;
        schema?: { current: boolean; missingTags: string[] };
      };
      expect(healthBody).toMatchObject({ ok: true });
      expect(healthBody.schema).toMatchObject({ current: true, missingTags: [] });

      const unknown = await app.request('/api/v1/unknown');
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'not_found' });
    }
  });

  it('boots with no better-auth secret configured — feature absent, no crash (REQ-5)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const app = createApp({ db, bindHost: '127.0.0.1' });

    // Mirrors github: undefined — the route simply doesn't exist.
    const res = await app.request('/api/auth/session');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('refuses the public email-and-password sign-up path (REQ-1)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const response = await auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Unvouched user',
          email: 'unvouched@example.com',
          password: 'CorrectHorseBattery1!',
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
    await expect((await auth.$context).adapter.count({ model: 'user' })).resolves.toBe(0);
  });

  it('links verified trusted-created password identity to GitHub as one user (REQ-2)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'github-client', clientSecret: 'github-secret' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const user = await adapter.create<BetterAuthUser>({
      model: 'user',
      data: {
        name: 'Invited owner',
        email: 'owner@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create<BetterAuthAccount>({
      model: 'account',
      data: {
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: 'trusted-server-created-password-hash',
        createdAt: now,
        updatedAt: now,
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === 'https://github.com/login/oauth/access_token') {
          return Promise.resolve(
            jsonResponse({ access_token: 'github-token', token_type: 'bearer' }),
          );
        }
        if (url === 'https://api.github.com/user') {
          return Promise.resolve(
            jsonResponse({
              id: 583231,
              login: 'renamable-login',
              name: 'GitHub Owner',
              email: 'owner@example.com',
              avatar_url: 'https://avatars.example/owner',
            }),
          );
        }
        if (url === 'https://api.github.com/user/emails') {
          return Promise.resolve(
            jsonResponse([{ email: 'owner@example.com', primary: true, verified: true }]),
          );
        }
        throw new Error(`unexpected GitHub request: ${url}`);
      }),
    );

    const start = await auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'github', callbackURL: '/after-sign-in' }),
      }),
    );
    expect(start.status).toBe(200);
    const startBody: unknown = await start.json();
    if (
      typeof startBody !== 'object' ||
      startBody === null ||
      !('url' in startBody) ||
      typeof startBody.url !== 'string'
    ) {
      throw new Error('expected GitHub authorization URL');
    }
    const state = new URL(startBody.url).searchParams.get('state');
    const stateCookie = start.headers.get('set-cookie')?.split(';', 1)[0];
    if (state === null || stateCookie === undefined)
      throw new Error('expected OAuth state and cookie');

    const callback = await auth.handler(
      new Request(
        `${TEST_BASE_URL}/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: stateCookie } },
      ),
    );
    expect(callback.status).toBe(302);

    const users = await adapter.findMany<BetterAuthUser>({ model: 'user' });
    const accounts = await adapter.findMany<BetterAuthAccount>({ model: 'account' });
    expect(users).toHaveLength(1);
    expect(accounts.map((account) => account.providerId).sort()).toEqual(['credential', 'github']);
    expect(accounts.find((account) => account.providerId === 'github')).toMatchObject({
      accountId: '583231',
      userId: user.id,
    });
  });
});
