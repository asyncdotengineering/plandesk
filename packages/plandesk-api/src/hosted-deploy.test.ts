import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import { createDb, migrate } from '@plandesk/db';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { createApp } from './server.js';
import {
  MISSING_BASE_URL_MESSAGE,
  MISSING_BETTER_AUTH_SECRET_MESSAGE,
  hostedMisconfigResponse,
  resolveHostedBetterAuth,
} from './hosted-auth.js';
import { parseJson } from './test-helpers.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'https://plandesk-api.example.workers.dev';

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
  createdAt: Date;
  updatedAt: Date;
};

type BetterAuthSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type BetterAuthOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
};

type BetterAuthMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

async function seedSession(
  auth: BetterAuthInstance,
  opts: {
    email: string;
    name: string;
    githubAccountId: string;
    org: { id: string; name: string; slug: string };
  },
): Promise<{ cookie: string }> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: opts.name,
      email: opts.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthAccount>({
    model: 'account',
    data: {
      accountId: opts.githubAccountId,
      providerId: 'github',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  const orgData = {
    id: opts.org.id,
    name: opts.org.name,
    slug: opts.org.slug,
    createdAt: now,
  };
  await adapter.create<BetterAuthOrganization>({
    model: 'organization',
    data: orgData,
    forceAllowId: true,
  });
  await adapter.create<BetterAuthMember>({
    model: 'member',
    data: {
      organizationId: opts.org.id,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    },
  });
  const token = `ba-sess-${opts.githubAccountId}-${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await adapter.create<BetterAuthSession>({
    model: 'session',
    data: {
      userId: user.id,
      token,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  });
  const ctx = await auth.$context;
  const signed = `${token}.${await makeSignature(token, ctx.secret)}`;
  return { cookie: `${ctx.authCookies.sessionToken.name}=${signed}` };
}

describe('hosted better-auth wiring (BA9)', () => {
  it('resolveHostedBetterAuth fails loud when secret is missing (not silent 401)', () => {
    expect(() => resolveHostedBetterAuth({}, 'https://example.workers.dev')).toThrow(
      MISSING_BETTER_AUTH_SECRET_MESSAGE,
    );
    expect(() =>
      resolveHostedBetterAuth({ PLANDESK_BETTER_AUTH_SECRET: '   ' }, 'https://example.workers.dev'),
    ).toThrow(MISSING_BETTER_AUTH_SECRET_MESSAGE);

    const response = hostedMisconfigResponse(new Error(MISSING_BETTER_AUTH_SECRET_MESSAGE));
    expect(response).toBeDefined();
    expect(response?.status).toBe(500);
  });

  it('resolveHostedBetterAuth prefers PLANDESK_BASE_URL, falls back to request origin', () => {
    expect(
      resolveHostedBetterAuth(
        {
          PLANDESK_BETTER_AUTH_SECRET: TEST_SECRET,
          PLANDESK_BASE_URL: 'https://configured.example.com/',
        },
        'https://request-origin.example',
      ),
    ).toEqual({ secret: TEST_SECRET, baseURL: 'https://configured.example.com' });

    expect(
      resolveHostedBetterAuth({ PLANDESK_BETTER_AUTH_SECRET: TEST_SECRET }, 'https://from-request.dev/'),
    ).toEqual({ secret: TEST_SECRET, baseURL: 'https://from-request.dev' });

    expect(() => resolveHostedBetterAuth({ PLANDESK_BETTER_AUTH_SECRET: TEST_SECRET })).toThrow(
      MISSING_BASE_URL_MESSAGE,
    );
  });

  it('createApp on 0.0.0.0 WITH betterAuth: /api/auth/* reachable + session resolves /auth/session 200', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const orgId = randomUUID();
    const { cookie } = await seedSession(auth, {
      email: 'hosted@example.com',
      name: 'Hosted Owner',
      githubAccountId: '9001',
      org: { id: orgId, name: 'Hosted Org', slug: 'hosted-org' },
    });

    // Mirrors worker/vercel: non-loopback bind + betterAuth from resolveHostedBetterAuth.
    const betterAuth = resolveHostedBetterAuth(
      {
        PLANDESK_BETTER_AUTH_SECRET: TEST_SECRET,
        PLANDESK_BASE_URL: TEST_BASE_URL,
      },
      'https://ignored-when-env-set.example',
    );
    const app = createApp({
      db,
      bindHost: '0.0.0.0',
      betterAuth,
      github: {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        callbackUrl: `${TEST_BASE_URL}/api/auth/callback/github`,
      },
    });

    const ok = await app.request('/api/auth/ok');
    expect(ok.status).toBe(200);

    const getSession = await app.request('/api/auth/get-session');
    expect(getSession.status).not.toBe(401);
    expect(getSession.status).not.toBe(404);

    const session = await app.request('/api/v1/auth/session', {
      headers: { Cookie: cookie },
    });
    expect(session.status).toBe(200);
    expect(await parseJson(session)).toEqual({
      kind: 'session',
      user_ref: 'github:9001',
      role: 'owner',
      org: { id: orgId, name: 'Hosted Org' },
      orgs: [{ id: orgId, name: 'Hosted Org', role: 'owner' }],
      active_workspace: null,
      workspaces: [],
    });
  });

  it('createApp on 0.0.0.0 WITHOUT betterAuth: stranger gets 401 (entry must fail-fast before this)', async () => {
    // Documents the silent-401 failure mode the Worker/Vercel entries must not hit —
    // resolveHostedBetterAuth + hostedMisconfigResponse return 500 naming the secret instead.
    const db = await createDb(':memory:');
    await migrate(db);
    const app = createApp({ db, bindHost: '0.0.0.0' });

    const projects = await app.request('/api/v1/projects');
    expect(projects.status).toBe(401);

    const ba = await app.request('/api/auth/session');
    expect(ba.status).toBe(404);

    const misconfig = hostedMisconfigResponse(new Error(MISSING_BETTER_AUTH_SECRET_MESSAGE));
    expect(misconfig?.status).toBe(500);
    const body = await parseJson<{ error: string; message: string }>(misconfig!);
    expect(body.error).toBe('misconfigured');
    expect(body.message).toContain('PLANDESK_BETTER_AUTH_SECRET');
  });
});
