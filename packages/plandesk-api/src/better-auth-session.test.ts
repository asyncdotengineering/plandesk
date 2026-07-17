import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import {
  DEFAULT_ORG_ID,
  createDb,
  createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import type { Hono } from 'hono';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { createApp } from './server.js';
import { createTestApp, parseJson } from './test-helpers.js';

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

async function seedBetterAuthUser(
  auth: BetterAuthInstance,
  opts: {
    email: string;
    name: string;
    githubAccountId: string;
    org: { id: string; name: string; slug: string };
    role: 'owner' | 'admin' | 'member';
    memberCreatedAt?: Date;
  },
): Promise<{ userId: string; cookie: string }> {
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

  const existingOrg = await adapter.findOne<BetterAuthOrganization>({
    model: 'organization',
    where: [{ field: 'id', value: opts.org.id }],
  });
  if (existingOrg === null) {
    // Intermediate object: forceAllowId accepts id; object-literal excess-property check does not.
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
  }

  await adapter.create<BetterAuthMember>({
    model: 'member',
    data: {
      organizationId: opts.org.id,
      userId: user.id,
      role: opts.role,
      createdAt: opts.memberCreatedAt ?? now,
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
  const cookie = `${ctx.authCookies.sessionToken.name}=${signed}`;
  return { userId: user.id, cookie };
}

async function hostedBetterAuthApp(): Promise<{
  app: Hono;
  db: Db;
  auth: BetterAuthInstance;
}> {
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

describe('better-auth session recognition (BA4a)', () => {
  it('a better-auth session sees only its own org projects (cross-org denied)', async () => {
    const { app, db, auth } = await hostedBetterAuthApp();
    const mine = { id: randomUUID(), name: 'Mine' };
    const other = { id: randomUUID(), name: 'Other' };
    const otherProject = await createProject(db, { name: 'Not Yours', orgId: other.id });

    const { cookie } = await seedBetterAuthUser(auth, {
      email: 'ada@example.com',
      name: 'Ada',
      githubAccountId: '1001',
      org: { id: mine.id, name: mine.name, slug: 'mine' },
      role: 'owner',
    });

    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mine Board' }),
    });
    expect(created.status).toBe(201);

    const list = await parseJson<Array<{ id: string; name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: cookie } }),
    );
    expect(list.map((p) => p.name)).toEqual(['Mine Board']);
    expect(list.some((p) => p.id === otherProject.id)).toBe(false);

    const cross = await app.request(`/api/v1/projects/${otherProject.id}`, {
      headers: { Cookie: cookie },
    });
    expect(cross.status).toBe(404);

    const session = await parseJson<{ kind: string; user_ref: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(session.kind).toBe('session');
    expect(session.user_ref).toBe('github:1001');
    expect(session.org.id).toBe(mine.id);
  });

  it('an existing user can accept an invite and switch between both organizations', async () => {
    const { app, db, auth } = await hostedBetterAuthApp();
    const orgA = { id: randomUUID(), name: 'Personal A', slug: 'personal-a' };
    const orgB = { id: randomUUID(), name: 'Team B', slug: 'team-b' };
    const teamOwner = await seedBetterAuthUser(auth, {
      email: 'owner-b@example.com',
      name: 'Owner B',
      githubAccountId: '1101',
      org: orgB,
      role: 'owner',
    });
    const invitee = await seedBetterAuthUser(auth, {
      email: 'invitee@example.com',
      name: 'Invitee',
      githubAccountId: '1102',
      org: orgA,
      role: 'owner',
    });
    const projectA = await createProject(db, { name: 'Personal board', orgId: orgA.id });
    const projectB = await createProject(db, { name: 'Team board', orgId: orgB.id });

    const invite = await app.request(`/api/v1/orgs/${orgB.id}/invitations`, {
      method: 'POST',
      headers: { Cookie: teamOwner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com', role: 'member' }),
    });
    expect(invite.status).toBe(201);
    const { invitationId } = await parseJson<{ invitationId: string }>(invite);

    const beforeAccept = await app.request('/api/v1/auth/session', {
      headers: { Cookie: invitee.cookie },
    });
    expect((await parseJson<{ org: { id: string } }>(beforeAccept)).org.id).toBe(orgA.id);
    expect((await app.request(`/api/v1/projects/${projectA.id}`, { headers: { Cookie: invitee.cookie } })).status).toBe(200);
    expect((await app.request(`/api/v1/projects/${projectB.id}`, { headers: { Cookie: invitee.cookie } })).status).toBe(404);

    const accept = await app.request(`/api/v1/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie },
    });
    expect(accept.status).toBe(200);

    const selectA = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { Cookie: invitee.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgA.id }),
    });
    expect(selectA.status).toBe(200);
    const activeA = await parseJson<{ org: { id: string }; orgs: Array<{ id: string }> }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: invitee.cookie } }),
    );
    expect(activeA.org.id).toBe(orgA.id);
    expect(activeA.orgs.map((org) => org.id)).toEqual([orgA.id, orgB.id]);
    expect((await app.request(`/api/v1/projects/${projectA.id}`, { headers: { Cookie: invitee.cookie } })).status).toBe(200);
    expect((await app.request(`/api/v1/projects/${projectB.id}`, { headers: { Cookie: invitee.cookie } })).status).toBe(404);

    const selectB = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { Cookie: invitee.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgB.id }),
    });
    expect(selectB.status).toBe(200);
    const activeB = await parseJson<{ org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: invitee.cookie } }),
    );
    expect(activeB.org.id).toBe(orgB.id);
    expect((await app.request(`/api/v1/projects/${projectB.id}`, { headers: { Cookie: invitee.cookie } })).status).toBe(200);
    expect((await app.request(`/api/v1/projects/${projectA.id}`, { headers: { Cookie: invitee.cookie } })).status).toBe(404);
  });

  it('revoking better-auth membership stops the session (401)', async () => {
    const { app, db, auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Team' };
    const { cookie, userId } = await seedBetterAuthUser(auth, {
      email: 'revoked@example.com',
      name: 'Revoked',
      githubAccountId: '2002',
      org: { id: org.id, name: org.name, slug: 'team' },
      role: 'owner',
    });

    expect((await app.request('/api/v1/projects', { headers: { Cookie: cookie } })).status).toBe(
      200,
    );

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [{ field: 'userId', value: userId }],
    });
    for (const member of members) {
      await adapter.delete({
        model: 'member',
        where: [{ field: 'id', value: member.id }],
      });
    }

    const res = await app.request('/api/v1/projects', { headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });

  it('better-auth role gates writes: member denied project:create, owner allowed', async () => {
    const { app, db, auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Roles' };

    const member = await seedBetterAuthUser(auth, {
      email: 'member@example.com',
      name: 'Member',
      githubAccountId: '3003',
      org: { id: org.id, name: org.name, slug: 'roles' },
      role: 'member',
    });
    const owner = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '3004',
      org: { id: org.id, name: org.name, slug: 'roles' },
      role: 'owner',
    });

    const denied = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { Cookie: member.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Fail' }),
    });
    expect(denied.status).toBe(403);
    expect(await parseJson(denied)).toEqual({ error: 'forbidden' });

    const allowed = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Allowed Board' }),
    });
    expect(allowed.status).toBe(201);

    // Member can still read projects in the org.
    const list = await app.request('/api/v1/projects', { headers: { Cookie: member.cookie } });
    expect(list.status).toBe(200);
    const projects = await parseJson<Array<{ name: string }>>(list);
    expect(projects.map((p) => p.name)).toEqual(['Allowed Board']);
  });

  it('/api/auth/* is reachable by a stranger without a plandesk credential', async () => {
    const { app } = await hostedBetterAuthApp();

    const ok = await app.request('/api/auth/ok');
    expect(ok.status).toBe(200);

    const session = await app.request('/api/auth/get-session');
    // better-auth answers; not 401 from plandesk org middleware.
    expect(session.status).not.toBe(401);
  });

  it('self-host without GitHub app: loopback still works; stranger bearer 401 (REQ-20)', async () => {
    // No betterAuth, no github — mirrors a plain self-host install.
    const { app: hosted } = await createTestApp({ bindHost: '0.0.0.0' });
    const stranger = await hosted.request('/api/v1/projects');
    expect(stranger.status).toBe(401);
    expect(await parseJson(stranger)).toEqual({ error: 'unauthorized' });

    const badBearer = await hosted.request('/api/v1/projects', {
      headers: { Authorization: 'Bearer plandesk_mcp_not-real' },
    });
    expect(badBearer.status).toBe(401);

    // better-auth mount absent → 404, not a crash.
    const ba = await hosted.request('/api/auth/session');
    expect(ba.status).toBe(404);

    // Loopback single-org works without a credential.
    const { app: local } = await createTestApp({ bindHost: '127.0.0.1' });
    const withLoopback = await local.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Self-hosted board' }),
    });
    expect(withLoopback.status).toBe(201);
  });

  it('local loopback is unchanged with better-auth configured (REQ-21)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const org = { id: DEFAULT_ORG_ID, name: 'Personal' };
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const app = createApp({
      db,
      bindHost: '127.0.0.1',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    });

    // No better-auth cookie → loopback owner on the default org.
    const res = await app.request('/api/v1/auth/session');
    expect(res.status).toBe(200);
    expect(await parseJson(res)).toEqual({
      kind: 'loopback',
      user_ref: null,
      role: 'owner',
      org: { id: org.id, name: 'Personal' },
      orgs: [{ id: org.id, name: 'Personal', role: 'owner' }],
    });
  });

  it('numeric GitHub id is the identity — rename keeps the same org membership', async () => {
    const { app, db, auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Stable' };
    const { cookie } = await seedBetterAuthUser(auth, {
      email: 'stable@example.com',
      name: 'Stable',
      githubAccountId: '583231',
      org: { id: org.id, name: org.name, slug: 'stable' },
      role: 'owner',
    });

    const before = await parseJson<{ user_ref: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(before.user_ref).toBe('github:583231');
    expect(before.org.id).toBe(org.id);

    // Renaming the better-auth user display name does not change user_ref or org.
    const adapter = (await auth.$context).adapter;
    const account = await adapter.findOne<BetterAuthAccount>({
      model: 'account',
      where: [
        { field: 'providerId', value: 'github' },
        { field: 'accountId', value: '583231' },
      ],
    });
    if (account === null) throw new Error('expected github account');
    await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: account.userId }],
      update: { name: 'Renamed Login' },
    });

    const after = await parseJson<{ user_ref: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(after.user_ref).toBe('github:583231');
    expect(after.org.id).toBe(org.id);
  });

  it('an explicitly selected active org wins over membership order', async () => {
    const { app, db, auth } = await hostedBetterAuthApp();
    const first = { id: randomUUID(), name: 'First' };
    const second = { id: randomUUID(), name: 'Second' };

    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const user = await adapter.create<BetterAuthUser>({
      model: 'user',
      data: {
        name: 'Multi',
        email: 'multi@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    await adapter.create<BetterAuthAccount>({
      model: 'account',
      data: {
        accountId: '4004',
        providerId: 'github',
        userId: user.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    for (const org of [
      { id: first.id, name: first.name, slug: 'first', at: new Date('2020-01-01') },
      { id: second.id, name: second.name, slug: 'second', at: new Date('2021-01-01') },
    ]) {
      const orgData = {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.at,
      };
      await adapter.create<BetterAuthOrganization>({
        model: 'organization',
        data: orgData,
        forceAllowId: true,
      });
      await adapter.create<BetterAuthMember>({
        model: 'member',
        data: {
          organizationId: org.id,
          userId: user.id,
          role: 'owner',
          createdAt: org.at,
        },
      });
    }

    const token = 'ba-sess-multi-org';
    await adapter.create<BetterAuthSession>({
      model: 'session',
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: now,
        updatedAt: now,
      },
    });
    const ctx = await auth.$context;
    const signed = `${token}.${await makeSignature(token, ctx.secret)}`;
    const cookie = `${ctx.authCookies.sessionToken.name}=${signed}`;

    const select = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: second.id }),
    });
    expect(select.status).toBe(200);

    const session = await parseJson<{ org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(session.org.id).toBe(second.id);
  });
});
