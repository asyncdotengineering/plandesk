import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import { createDb, migrate, type Db } from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
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

type TeamRow = {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
};

type TeamMemberRow = {
  id: string;
  teamId: string;
  userId: string;
  createdAt: Date;
};

async function seedUser(
  auth: BetterAuthInstance,
  opts: {
    orgId: string;
    email: string;
    name: string;
    githubAccountId: string;
    role: 'owner' | 'admin' | 'member';
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
  await adapter.create<BetterAuthMember>({
    model: 'member',
    data: {
      organizationId: opts.orgId,
      userId: user.id,
      role: opts.role,
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
  const cookie = `${ctx.authCookies.sessionToken.name}=${signed}`;
  return { userId: user.id, cookie };
}

async function createOrgTeam(
  auth: BetterAuthInstance,
  orgId: string,
  name: string,
): Promise<TeamRow> {
  const adapter = (await auth.$context).adapter;
  return adapter.create<TeamRow>({
    model: 'team',
    data: { name, organizationId: orgId, createdAt: new Date() },
  });
}

async function addTeamMember(
  auth: BetterAuthInstance,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow> {
  const adapter = (await auth.$context).adapter;
  return adapter.create<TeamMemberRow>({
    model: 'teamMember',
    data: { teamId, userId, createdAt: new Date() },
  });
}

async function removeTeamMember(auth: BetterAuthInstance, teamMemberId: string): Promise<void> {
  const adapter = (await auth.$context).adapter;
  await adapter.delete({ model: 'teamMember', where: [{ field: 'id', value: teamMemberId }] });
}

async function setup(): Promise<{
  app: Hono;
  db: Db;
  auth: BetterAuthInstance;
  orgId: string;
  teamA: TeamRow;
  teamB: TeamRow;
  projectA: { id: string; name: string };
  projectB: { id: string; name: string };
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

  const orgId = randomUUID();
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  // Intermediate object: forceAllowId accepts id; object-literal excess-property check does not.
  const orgData = {
    id: orgId,
    name: 'Engagement Org',
    slug: 'engagement',
    createdAt: now,
  };
  await adapter.create<BetterAuthOrganization>({
    model: 'organization',
    data: orgData,
    forceAllowId: true,
  });

  // Two workspaces (teams) in the org — created directly so we control exactly
  // who is a member of each (ensureDefaultTeamForOrg would add every org member).
  const teamA = await createOrgTeam(auth, orgId, 'Workspace A');
  const teamB = await createOrgTeam(auth, orgId, 'Workspace B');
  const projectA = await createProject(db, {
    name: 'A Board',
    orgId,
    workspaceId: teamA.id,
  });
  const projectB = await createProject(db, {
    name: 'B Board',
    orgId,
    workspaceId: teamB.id,
  });

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
  return { app, db, auth, orgId, teamA, teamB, projectA, projectB };
}

describe('session workspace membership (RFC §12)', () => {
  it('a member sees only their own workspace — list + get; cross-workspace is 404', async () => {
    const { app, db, auth, orgId, teamA, projectA, projectB } = await setup();
    const member = await seedUser(auth, {
      orgId,
      email: 'member@example.com',
      name: 'Member',
      githubAccountId: '5001',
      role: 'member',
    });
    // Member of workspace A only.
    await addTeamMember(auth, teamA.id, member.userId);

    // GET a workspace-B project → 404 (no existence leak).
    const cross = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: { Cookie: member.cookie },
    });
    expect(cross.status).toBe(404);
    expect(await parseJson(cross)).toEqual({ error: 'not_found' });

    // GET a workspace-A project → 200.
    const own = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Cookie: member.cookie },
    });
    expect(own.status).toBe(200);

    // LIST omits workspace-B projects; includes workspace-A.
    const list = await parseJson<Array<{ id: string; name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: member.cookie } }),
    );
    expect(list.map((p) => p.name)).toEqual(['A Board']);
    expect(list.some((p) => p.id === projectB.id)).toBe(false);

    // Sanity: a project in a third workspace is also absent (member has none there).
    const teamC = await createOrgTeam(auth, orgId, 'Workspace C');
    await createProject(db, { name: 'C Board', orgId, workspaceId: teamC.id });
    const listAfter = await parseJson<Array<{ id: string; name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: member.cookie } }),
    );
    expect(listAfter.map((p) => p.name)).toEqual(['A Board']);
  });

  it('a member with zero workspace memberships sees no projects (fail-closed)', async () => {
    const { app, auth, orgId, projectA } = await setup();
    const member = await seedUser(auth, {
      orgId,
      email: 'nomad@example.com',
      name: 'Nomad',
      githubAccountId: '5002',
      role: 'member',
    });
    // No teamMember rows at all.

    const list = await parseJson<Array<{ id: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: member.cookie } }),
    );
    expect(list).toEqual([]);

    const get = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Cookie: member.cookie },
    });
    expect(get.status).toBe(404);
  });

  it('owner and admin are NOT workspace-gated — they see every org project', async () => {
    const { app, auth, orgId, projectA, projectB } = await setup();
    const owner = await seedUser(auth, {
      orgId,
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '5003',
      role: 'owner',
    });
    const admin = await seedUser(auth, {
      orgId,
      email: 'admin@example.com',
      name: 'Admin',
      githubAccountId: '5004',
      role: 'admin',
    });
    // Neither owner nor admin has any teamMember row — yet they manage the org.

    for (const [label, cookie] of [
      ['owner', owner.cookie],
      ['admin', admin.cookie],
    ] as const) {
      const list = await parseJson<Array<{ id: string; name: string }>>(
        await app.request('/api/v1/projects', { headers: { Cookie: cookie } }),
      );
      expect(list.map((p) => p.name).sort()).toEqual(['A Board', 'B Board']);

      const a = await app.request(`/api/v1/projects/${projectA.id}`, {
        headers: { Cookie: cookie },
      });
      expect(a.status).toBe(200);
      const b = await app.request(`/api/v1/projects/${projectB.id}`, {
        headers: { Cookie: cookie },
      });
      expect(b.status).toBe(200);
      void label;
    }
  });

  it('granting workspace-B membership opens access; revoking closes it again', async () => {
    const { app, auth, orgId, teamA, teamB, projectB } = await setup();
    const member = await seedUser(auth, {
      orgId,
      email: 'flux@example.com',
      name: 'Flux',
      githubAccountId: '5005',
      role: 'member',
    });
    await addTeamMember(auth, teamA.id, member.userId);

    // Initially blocked from workspace B.
    expect(
      (
        await app.request(`/api/v1/projects/${projectB.id}`, {
          headers: { Cookie: member.cookie },
        })
      ).status,
    ).toBe(404);

    // Grant workspace B → access (list + get), context resolves per-request.
    const grant = await addTeamMember(auth, teamB.id, member.userId);
    const listAfterGrant = await parseJson<Array<{ id: string; name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: member.cookie } }),
    );
    expect(listAfterGrant.map((p) => p.name).sort()).toEqual(['A Board', 'B Board']);
    expect(
      (
        await app.request(`/api/v1/projects/${projectB.id}`, {
          headers: { Cookie: member.cookie },
        })
      ).status,
    ).toBe(200);

    // Revoke workspace B → blocked again, same 404 no-leak shape.
    await removeTeamMember(auth, grant.id);
    const revoked = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: { Cookie: member.cookie },
    });
    expect(revoked.status).toBe(404);
    expect(await parseJson(revoked)).toEqual({ error: 'not_found' });
    const listAfterRevoke = await parseJson<Array<{ id: string; name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: member.cookie } }),
    );
    expect(listAfterRevoke.map((p) => p.name)).toEqual(['A Board']);
  });
});
