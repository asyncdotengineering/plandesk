/**
 * BA4c — better-auth web GitHub sign-in + personal org provision.
 *
 * Gates:
 * 1. Fresh GitHub session with no memberships → personal org owner; idempotent
 * 2. Invited member (member row exists) → no second personal org
 * 3. better-auth GitHub user → /auth/session org → /auth/cli-token 200
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import {
  createDb,
  createOrg,
  ensureDefaultOrg,
  getOrg,
  listOrgs,
  migrate,
  type Db,
} from '@plandesk/db';
import type { Hono } from 'hono';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { provisionPersonalOrgIfNeeded } from './identity.js';
import { createApp } from './server.js';
import { parseJson } from './test-helpers.js';

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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hostedApp(): Promise<{
  app: Hono;
  db: Db;
  auth: BetterAuthInstance;
}> {
  const db = await createDb(':memory:');
  await migrate(db);
  await ensureDefaultOrg(db);
  const auth = createBetterAuth({
    client: db.$client,
    db,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    github: { clientId: 'test-client', clientSecret: 'test-secret' },
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);

  const app = createApp({
    db,
    bindHost: '0.0.0.0',
    github: {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      callbackUrl: 'https://plandesk.test/api/v1/auth/github/callback',
      dashboardUrl: '/',
    },
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
  });
  return { app, db, auth };
}

async function createGithubUser(
  auth: BetterAuthInstance,
  opts: { email: string; name: string; githubAccountId: string },
): Promise<{ userId: string }> {
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
  return { userId: user.id };
}

async function countMembers(auth: BetterAuthInstance, userId: string): Promise<number> {
  const adapter = (await auth.$context).adapter;
  const members = await adapter.findMany<BetterAuthMember>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
  });
  return members.length;
}

async function listMemberOrgs(
  auth: BetterAuthInstance,
  userId: string,
): Promise<Array<{ organizationId: string; role: string }>> {
  const adapter = (await auth.$context).adapter;
  const members = await adapter.findMany<BetterAuthMember>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
    sortBy: { field: 'createdAt', direction: 'asc' },
  });
  return members.map((m) => ({ organizationId: m.organizationId, role: m.role }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BA4c personal org provision on better-auth GitHub sign-in', () => {
  it('gate 1: fresh GitHub user with no memberships → personal org owner; second call is idempotent', async () => {
    const { db, auth } = await hostedApp();
    const { userId } = await createGithubUser(auth, {
      email: 'fresh@example.com',
      name: 'Fresh User',
      githubAccountId: '91001',
    });

    expect(await countMembers(auth, userId)).toBe(0);

    // Simulate internalAdapter session create (fires databaseHooks).
    const firstSession = await (await auth.$context).internalAdapter.createSession(userId);
    expect(firstSession).not.toBeNull();

    const membersAfterFirst = await listMemberOrgs(auth, userId);
    expect(membersAfterFirst).toHaveLength(1);
    expect(membersAfterFirst[0]?.role).toBe('owner');
    const orgId = membersAfterFirst[0]?.organizationId;
    expect(orgId).toBeDefined();
    if (orgId === undefined) throw new Error('expected orgId');
    const plandeskOrg = await getOrg(db, orgId);
    expect(plandeskOrg).toMatchObject({ id: orgId, name: 'Fresh User' });

    const orgsAfterFirst = await listOrgs(db);
    const nonDefault = orgsAfterFirst.filter((o) => o.id === orgId);
    expect(nonDefault).toHaveLength(1);

    // Second session (return visit) must not mint another org.
    const secondSession = await (await auth.$context).internalAdapter.createSession(userId);
    expect(secondSession).not.toBeNull();
    expect(await countMembers(auth, userId)).toBe(1);
    expect(await listMemberOrgs(auth, userId)).toEqual([
      { organizationId: orgId, role: 'owner' },
    ]);

    // Direct call is also idempotent.
    await expect(provisionPersonalOrgIfNeeded(auth, db, userId)).resolves.toEqual({
      created: false,
      reason: 'already_member',
    });
  });

  it('gate 2: invited user (member row exists) → no personal org on sign-in', async () => {
    const { db, auth } = await hostedApp();
    const inviting = await createOrg(db, { name: 'Acme Inviting' });
    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const orgData = {
      id: inviting.id,
      name: inviting.name,
      slug: 'acme-inviting',
      createdAt: now,
    };
    await adapter.create<BetterAuthOrganization>({
      model: 'organization',
      data: orgData,
      forceAllowId: true,
    });

    const { userId } = await createGithubUser(auth, {
      email: 'invited@example.com',
      name: 'Invited Person',
      githubAccountId: '91002',
    });
    await adapter.create<BetterAuthMember>({
      model: 'member',
      data: {
        organizationId: inviting.id,
        userId,
        role: 'member',
        createdAt: now,
      },
    });

    const orgsBefore = (await listOrgs(db)).map((o) => o.id).sort();

    const session = await (await auth.$context).internalAdapter.createSession(userId);
    expect(session).not.toBeNull();

    expect(await listMemberOrgs(auth, userId)).toEqual([
      { organizationId: inviting.id, role: 'member' },
    ]);
    expect((await listOrgs(db)).map((o) => o.id).sort()).toEqual(orgsBefore);

    await expect(provisionPersonalOrgIfNeeded(auth, db, userId)).resolves.toEqual({
      created: false,
      reason: 'already_member',
    });
  });

  it('gate 3: provisioned better-auth GitHub user → /auth/session org → cli-token 200', async () => {
    const { app, db, auth } = await hostedApp();
    const { userId } = await createGithubUser(auth, {
      email: 'cli@example.com',
      name: 'CLI Web User',
      githubAccountId: '91003',
    });

    // Provision via the same hook path a real OAuth session would take.
    const baSession = await (await auth.$context).internalAdapter.createSession(userId);
    expect(baSession).not.toBeNull();
    if (baSession === null) throw new Error('expected session');

    const memberships = await listMemberOrgs(auth, userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('owner');
    const orgId = memberships[0]?.organizationId;
    expect(orgId).toBeDefined();
    if (orgId === undefined) throw new Error('expected orgId');
    expect(await getOrg(db, orgId)).toMatchObject({ id: orgId, name: 'CLI Web User' });

    // Cookie for the provisioned session (token already stored by internalAdapter).
    const ctx = await auth.$context;
    const signed = `${baSession.token}.${await makeSignature(baSession.token, ctx.secret)}`;
    const cookie = `${ctx.authCookies.sessionToken.name}=${signed}`;

    const sessionRes = await app.request('/api/v1/auth/session', {
      headers: { Cookie: cookie },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = await parseJson<{
      kind: string;
      role: string;
      user_ref: string | null;
      org: { id: string; name: string } | null;
    }>(sessionRes);
    expect(sessionBody.kind).toBe('session');
    expect(sessionBody.role).toBe('owner');
    expect(sessionBody.user_ref).toBe('github:91003');
    expect(sessionBody.org).toEqual({ id: orgId, name: 'CLI Web User' });

    const cliRes = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'From web' }),
    });
    expect(cliRes.status).toBe(200);
    const cliBody = await parseJson<{ token: string; org_id: string; org_name: string }>(cliRes);
    expect(cliBody.org_id).toBe(orgId);
    expect(cliBody.org_name).toBe('CLI Web User');
    expect(typeof cliBody.token).toBe('string');
    expect(cliBody.token.length).toBeGreaterThan(0);
  });

  it('OAuth callback path provisions org when better-auth creates the session (end-to-end handler)', async () => {
    const { db, auth } = await hostedApp();

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === 'https://github.com/login/oauth/access_token') {
          return Promise.resolve(jsonResponse({ access_token: 'github-token', token_type: 'bearer' }));
        }
        if (url === 'https://api.github.com/user') {
          return Promise.resolve(
            jsonResponse({
              id: 91004,
              login: 'oauth-fresh',
              name: 'OAuth Fresh',
              email: 'oauth-fresh@example.com',
              avatar_url: 'https://avatars.example/oauth',
            }),
          );
        }
        if (url === 'https://api.github.com/user/emails') {
          return Promise.resolve(
            jsonResponse([{ email: 'oauth-fresh@example.com', primary: true, verified: true }]),
          );
        }
        throw new Error(`unexpected GitHub request: ${url}`);
      }),
    );

    const start = await auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
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
    if (state === null || stateCookie === undefined) {
      throw new Error('expected OAuth state and cookie');
    }

    const callback = await auth.handler(
      new Request(
        `${TEST_BASE_URL}/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
        { headers: { Cookie: stateCookie } },
      ),
    );
    expect(callback.status).toBe(302);

    const adapter = (await auth.$context).adapter;
    const accounts = await adapter.findMany<BetterAuthAccount>({
      model: 'account',
      where: [
        { field: 'providerId', value: 'github' },
        { field: 'accountId', value: '91004' },
      ],
    });
    expect(accounts).toHaveLength(1);
    const userId = accounts[0]?.userId;
    expect(userId).toBeDefined();
    if (userId === undefined) throw new Error('expected userId');

    const memberships = await listMemberOrgs(auth, userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe('owner');
    const orgId = memberships[0]?.organizationId;
    expect(orgId).toBeDefined();
    if (orgId === undefined) throw new Error('expected orgId');
    expect(await getOrg(db, orgId)).toMatchObject({ id: orgId, name: 'OAuth Fresh' });
  });
});

describe('BA4c hand-rolled path remains (REQ-4 / gate 5)', () => {
  it('hand-rolled /auth/github is still mounted when github is configured', async () => {
    const { app } = await hostedApp();
    const res = await app.request('/api/v1/auth/github', { redirect: 'manual' });
    // Redirect to GitHub authorize, not 404.
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('github.com');
  });
});
