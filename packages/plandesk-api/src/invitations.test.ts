import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import {
  DEFAULT_ORG_ID,
  createDb,
  migrate,
  type Db,
} from '@plandesk/db';
import type { Hono } from 'hono';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import {
  isAuthApiError,
  mintOwnerInvitation,
  removeOrganizationMember,
  updateOrganizationMemberRole,
} from './invitations.js';
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

type BetterAuthInvitation = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  inviterId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

async function seedBetterAuthUser(
  auth: BetterAuthInstance,
  opts: {
    email: string;
    name: string;
    githubAccountId?: string;
    org?: { id: string; name: string; slug: string };
    role?: 'owner' | 'admin' | 'member';
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
  if (opts.githubAccountId !== undefined) {
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
  }

  if (opts.org !== undefined && opts.role !== undefined) {
    const existingOrg = await adapter.findOne<BetterAuthOrganization>({
      model: 'organization',
      where: [{ field: 'id', value: opts.org.id }],
    });
    if (existingOrg === null) {
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
  }

  const token = `ba-sess-${opts.email}-${Math.random().toString(36).slice(2)}`;
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

async function hostedInviteApp(opts?: { github?: boolean }): Promise<{
  app: Hono;
  db: Db;
  auth: BetterAuthInstance;
  orgId: string;
}> {
  const db = await createDb(':memory:');
  await migrate(db);
  const defaultOrg = { id: DEFAULT_ORG_ID, name: 'Personal' };
  const auth = createBetterAuth({
    client: db.$client,
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    github:
      opts?.github === false
        ? undefined
        : { clientId: 'test-client', clientSecret: 'test-secret' },
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);

  const adapter = (await auth.$context).adapter;
  const now = new Date();
  // Intermediate object: forceAllowId accepts id; object-literal excess-property check does not.
  const orgData = {
    id: defaultOrg.id,
    name: defaultOrg.name,
    slug: 'personal',
    createdAt: now,
  };
  await adapter.create<BetterAuthOrganization>({
    model: 'organization',
    data: orgData,
    forceAllowId: true,
  });

  const app = createApp({
    db,
    bindHost: '0.0.0.0',
    ...(opts?.github === false
      ? {}
      : {
          github: {
            clientId: 'test-client',
            clientSecret: 'test-secret',
            callbackUrl: 'https://plandesk.test/api/v1/auth/github/callback',
            dashboardUrl: '/',
          },
        }),
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
  });
  return { app, db, auth, orgId: defaultOrg.id };
}

describe('organization invitations (BA3c)', () => {
  it('gate1: owner invites by email → claim link; invitation row pending; no mailer', async () => {
    const { app, auth, orgId } = await hostedInviteApp();
    const owner = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '1001',
      org: { id: orgId, name: 'Personal', slug: 'personal' },
      role: 'owner',
    });

    const res = await app.request(`/api/v1/orgs/${orgId}/invitations`, {
      method: 'POST',
      headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = await parseJson<{ invitationId: string; claimUrl: string }>(res);
    expect(body.invitationId.length).toBeGreaterThan(0);
    expect(body.claimUrl).toBe(`${TEST_BASE_URL}/invite/${body.invitationId}`);

    const adapter = (await auth.$context).adapter;
    const invitation = await adapter.findOne<BetterAuthInvitation>({
      model: 'invitation',
      where: [{ field: 'id', value: body.invitationId }],
    });
    expect(invitation).not.toBeNull();
    expect(invitation?.email).toBe('dev@example.com');
    expect(invitation?.role).toBe('member');
    expect(invitation?.status).toBe('pending');
    expect(invitation?.organizationId).toBe(orgId);
  });

  it('gate2: signed-in invitee accepts → member; second accept fails (single-use)', async () => {
    const { app, auth, orgId } = await hostedInviteApp();
    const owner = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '1001',
      org: { id: orgId, name: 'Personal', slug: 'personal' },
      role: 'owner',
    });

    const invite = await app.request(`/api/v1/orgs/${orgId}/invitations`, {
      method: 'POST',
      headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', role: 'member' }),
    });
    expect(invite.status).toBe(201);
    const { invitationId } = await parseJson<{ invitationId: string }>(invite);

    const invitee = await seedBetterAuthUser(auth, {
      email: 'dev@example.com',
      name: 'Dev',
      githubAccountId: '2002',
    });

    const accept = await app.request(`/api/v1/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie },
    });
    expect(accept.status).toBe(200);
    const accepted = await parseJson<{ role: string; organizationId: string; userId: string }>(
      accept,
    );
    expect(accepted.role).toBe('member');
    expect(accepted.organizationId).toBe(orgId);
    expect(accepted.userId).toBe(invitee.userId);

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [
        { field: 'userId', value: invitee.userId },
        { field: 'organizationId', value: orgId },
      ],
    });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('member');

    const second = await app.request(`/api/v1/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { Cookie: invitee.cookie },
    });
    expect(second.status).toBe(410);
  });

  it('gate3: non-owner (member session) inviting → 403', async () => {
    const { app, auth, orgId } = await hostedInviteApp();
    await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '1001',
      org: { id: orgId, name: 'Personal', slug: 'personal' },
      role: 'owner',
    });
    const member = await seedBetterAuthUser(auth, {
      email: 'member@example.com',
      name: 'Member',
      githubAccountId: '3003',
      org: { id: orgId, name: 'Personal', slug: 'personal' },
      role: 'member',
      memberCreatedAt: new Date(Date.now() + 1000),
    });

    const res = await app.request(`/api/v1/orgs/${orgId}/invitations`, {
      method: 'POST',
      headers: { Cookie: member.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com', role: 'member' }),
    });
    expect(res.status).toBe(403);
  });

  it('gate4 / REQ-3: mintOwnerInvitation + accept → owner; works with no GitHub (REQ-20)', async () => {
    const { app, auth, orgId } = await hostedInviteApp({ github: false });

    const minted = await mintOwnerInvitation(auth, {
      email: 'founder@x.com',
      organizationId: orgId,
      baseURL: TEST_BASE_URL,
    });
    expect(minted.invitationId.length).toBeGreaterThan(0);
    expect(minted.claimUrl).toBe(`${TEST_BASE_URL}/invite/${minted.invitationId}`);

    const adapter = (await auth.$context).adapter;
    const invitation = await adapter.findOne<BetterAuthInvitation>({
      model: 'invitation',
      where: [{ field: 'id', value: minted.invitationId }],
    });
    expect(invitation?.role).toBe('owner');
    expect(invitation?.status).toBe('pending');
    expect(invitation?.email).toBe('founder@x.com');

    const founder = await seedBetterAuthUser(auth, {
      email: 'founder@x.com',
      name: 'Founder',
    });

    const accept = await app.request(`/api/v1/invitations/${minted.invitationId}/accept`, {
      method: 'POST',
      headers: { Cookie: founder.cookie },
    });
    expect(accept.status).toBe(200);
    const body = await parseJson<{ role: string; organizationId: string }>(accept);
    expect(body.role).toBe('owner');
    expect(body.organizationId).toBe(orgId);

    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [
        { field: 'userId', value: founder.userId },
        { field: 'organizationId', value: orgId },
      ],
    });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');
  });

  it('gate5 / REQ-4: demoting or removing the sole owner is rejected', async () => {
    const { auth, orgId } = await hostedInviteApp();
    const owner = await seedBetterAuthUser(auth, {
      email: 'sole@example.com',
      name: 'Sole',
      githubAccountId: '9001',
      org: { id: orgId, name: 'Personal', slug: 'personal' },
      role: 'owner',
    });

    const headers = new Headers();
    headers.set('cookie', owner.cookie);

    let removeErr: unknown;
    try {
      await removeOrganizationMember(auth, {
        memberIdOrEmail: 'sole@example.com',
        organizationId: orgId,
        headers,
      });
    } catch (err) {
      removeErr = err;
    }
    expect(removeErr).toBeDefined();
    expect(isAuthApiError(removeErr)).toBe(true);
    if (isAuthApiError(removeErr)) {
      expect(removeErr.statusCode).toBeGreaterThanOrEqual(400);
    }

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [{ field: 'organizationId', value: orgId }],
    });
    const owners = members.filter((m) => m.role.split(',').includes('owner'));
    expect(owners.length).toBeGreaterThanOrEqual(1);

    const sole = owners[0];
    expect(sole).toBeDefined();
    if (sole === undefined) throw new Error('expected owner member');

    let demoteErr: unknown;
    try {
      await updateOrganizationMemberRole(auth, {
        memberId: sole.id,
        role: 'member',
        organizationId: orgId,
        headers,
      });
    } catch (err) {
      demoteErr = err;
    }
    expect(demoteErr).toBeDefined();
    expect(isAuthApiError(demoteErr)).toBe(true);

    const after = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [{ field: 'organizationId', value: orgId }],
    });
    expect(after.filter((m) => m.role.split(',').includes('owner')).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('owner of org-A cannot create invitations on org-B (404)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const orgA = { id: DEFAULT_ORG_ID, name: 'Personal' };
    const orgB = { id: randomUUID(), name: 'Other' };
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const adapter = (await auth.$context).adapter;
    const now = new Date();
    for (const o of [
      { id: orgA.id, name: orgA.name, slug: 'personal' },
      { id: orgB.id, name: orgB.name, slug: 'other' },
    ]) {
      const orgData = { id: o.id, name: o.name, slug: o.slug, createdAt: now };
      await adapter.create<BetterAuthOrganization>({
        model: 'organization',
        data: orgData,
        forceAllowId: true,
      });
    }

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

    const owner = await seedBetterAuthUser(auth, {
      email: 'aowner@example.com',
      name: 'AOwner',
      githubAccountId: '555',
      org: { id: orgA.id, name: orgA.name, slug: 'personal' },
      role: 'owner',
    });

    const res = await app.request(`/api/v1/orgs/${orgB.id}/invitations`, {
      method: 'POST',
      headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', role: 'member' }),
    });
    expect(res.status).toBe(404);
  });

});
