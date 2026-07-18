import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import { createDb, migrate, type Db } from '@plandesk/db';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { setDefaultActiveTeam, ensureDefaultTeamForOrg } from './identity.js';

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

type BetterAuthTeam = {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
};

type BetterAuthTeamMember = {
  id: string;
  teamId: string;
  userId: string;
  createdAt: Date;
};

async function seedUserOrgAndSession(
  auth: BetterAuthInstance,
  opts: {
    email: string;
    name: string;
    githubAccountId: string;
    org: { id: string; name: string; slug: string };
    role: 'owner' | 'admin' | 'member';
    sessionToken: string;
  },
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
      createdAt: now,
    },
  });

  await adapter.create<BetterAuthSession>({
    model: 'session',
    data: {
      userId: user.id,
      token: opts.sessionToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
  });

  return { userId: user.id };
}

async function hostedBetterAuthApp(): Promise<{
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
  return { db, auth };
}

describe('setDefaultActiveTeam', () => {
  it('sets activeTeamId to the org’s default team', async () => {
    const { auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Acme', slug: 'acme' };
    const sessionToken = 'ba-sess-default-team';
    const { userId } = await seedUserOrgAndSession(auth, {
      email: 'alice@example.com',
      name: 'Alice',
      githubAccountId: '1001',
      org,
      role: 'owner',
      sessionToken,
    });

    const teamId = await ensureDefaultTeamForOrg(auth, org.id);

    const result = await setDefaultActiveTeam(auth, userId, sessionToken, org.id);
    expect(result).toBe(teamId);

    const adapter = (await auth.$context).adapter;
    const session = await adapter.findOne<BetterAuthSession>({
      model: 'session',
      where: [{ field: 'token', value: sessionToken }],
    });
    expect(session).not.toBeNull();
    expect((session as BetterAuthSession & { activeTeamId?: string | null }).activeTeamId).toBe(
      teamId,
    );
  });

  it('prefers a prior session’s valid activeTeamId', async () => {
    const { auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Acme', slug: 'acme' };
    const priorToken = 'ba-sess-prior';
    const newToken = 'ba-sess-new';

    const { userId } = await seedUserOrgAndSession(auth, {
      email: 'bob@example.com',
      name: 'Bob',
      githubAccountId: '2002',
      org,
      role: 'owner',
      sessionToken: priorToken,
    });

    const teamId = await ensureDefaultTeamForOrg(auth, org.id);

    // Create a second team in the same org and add Bob to it.
    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const secondTeam = await adapter.create<BetterAuthTeam>({
      model: 'team',
      data: {
        name: 'Second',
        organizationId: org.id,
        createdAt: now,
      },
    });
    await adapter.create<BetterAuthTeamMember>({
      model: 'teamMember',
      data: {
        teamId: secondTeam.id,
        userId,
        createdAt: now,
      },
    });

    // Prior session has activeTeamId set to the second team.
    await adapter.update({
      model: 'session',
      where: [{ field: 'token', value: priorToken }],
      update: { activeTeamId: secondTeam.id },
    });

    // Seed the new session.
    await adapter.create<BetterAuthSession>({
      model: 'session',
      data: {
        userId,
        token: newToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      },
    });

    const result = await setDefaultActiveTeam(auth, userId, newToken, org.id);
    expect(result).toBe(secondTeam.id);

    const session = await adapter.findOne<BetterAuthSession>({
      model: 'session',
      where: [{ field: 'token', value: newToken }],
    });
    expect(session).not.toBeNull();
    expect(
      (session as BetterAuthSession & { activeTeamId?: string | null }).activeTeamId,
    ).toBe(secondTeam.id);
  });

  it('never chooses a team from a different org', async () => {
    const { auth } = await hostedBetterAuthApp();
    const orgA = { id: randomUUID(), name: 'Org A', slug: 'org-a' };
    const orgB = { id: randomUUID(), name: 'Org B', slug: 'org-b' };
    const priorToken = 'ba-sess-prior-other-org';
    const newToken = 'ba-sess-new-same-org';

    // Seed user in org A with a session whose activeTeamId points to org B's team.
    const { userId } = await seedUserOrgAndSession(auth, {
      email: 'carol@example.com',
      name: 'Carol',
      githubAccountId: '3003',
      org: orgA,
      role: 'owner',
      sessionToken: priorToken,
    });

    // Also make Carol a member of org B.
    const adapter = (await auth.$context).adapter;
    const now = new Date();
    const orgBData = {
      id: orgB.id,
      name: orgB.name,
      slug: orgB.slug,
      createdAt: now,
    };
    await adapter.create<BetterAuthOrganization>({
      model: 'organization',
      data: orgBData,
      forceAllowId: true,
    });
    await adapter.create<BetterAuthMember>({
      model: 'member',
      data: {
        organizationId: orgB.id,
        userId,
        role: 'member',
        createdAt: now,
      },
    });

    const teamA = await ensureDefaultTeamForOrg(auth, orgA.id);
    const teamB = await ensureDefaultTeamForOrg(auth, orgB.id);

    // Prior session has activeTeamId set to org B's team.
    await adapter.update({
      model: 'session',
      where: [{ field: 'token', value: priorToken }],
      update: { activeTeamId: teamB },
    });

    // Seed the new session for org A.
    await adapter.create<BetterAuthSession>({
      model: 'session',
      data: {
        userId,
        token: newToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      },
    });

    // When resolving for org A, the prior session's org-B team must be ignored.
    const result = await setDefaultActiveTeam(auth, userId, newToken, orgA.id);
    expect(result).toBe(teamA);

    const session = await adapter.findOne<BetterAuthSession>({
      model: 'session',
      where: [{ field: 'token', value: newToken }],
    });
    expect(session).not.toBeNull();
    expect(
      (session as BetterAuthSession & { activeTeamId?: string | null }).activeTeamId,
    ).toBe(teamA);
  });

  it('returns undefined when the user has no team memberships', async () => {
    const { auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Acme', slug: 'acme' };
    const sessionToken = 'ba-sess-no-teams';

    const { userId } = await seedUserOrgAndSession(auth, {
      email: 'dave@example.com',
      name: 'Dave',
      githubAccountId: '4004',
      org,
      role: 'owner',
      sessionToken,
    });

    // Do NOT call ensureDefaultTeamForOrg, so Dave has no teamMember rows.
    const result = await setDefaultActiveTeam(auth, userId, sessionToken, org.id);
    expect(result).toBeUndefined();
  });

  it('returns undefined when activeOrganizationId is undefined', async () => {
    const { auth } = await hostedBetterAuthApp();
    const org = { id: randomUUID(), name: 'Acme', slug: 'acme' };
    const sessionToken = 'ba-sess-no-org';

    const { userId } = await seedUserOrgAndSession(auth, {
      email: 'eve@example.com',
      name: 'Eve',
      githubAccountId: '5005',
      org,
      role: 'owner',
      sessionToken,
    });

    await ensureDefaultTeamForOrg(auth, org.id);

    const result = await setDefaultActiveTeam(auth, userId, sessionToken, undefined);
    expect(result).toBeUndefined();
  });
});
