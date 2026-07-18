import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import {
  DEFAULT_ORG_ID,
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import type { Hono } from 'hono';
import {
  createOrgOwnerKey,
  createScopedAgentKey,
  verifyBetterAuthApiKey,
} from '../agent-keys.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from '../better-auth.js';
import { ensureDefaultTeamForOrg } from '../identity.js';
import { createApp } from '../server.js';
import { parseJson } from '../test-helpers.js';

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

async function hostedApp(): Promise<{
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

function bearer(key: string): { Authorization: string } {
  return { Authorization: `Bearer ${key}` };
}

describe('GET /api/v1/orgs/:orgId/workspaces (REQ-A1)', () => {
  it('lists teams in the org for any member', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'List Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9001',
      org: { id: org.id, name: org.name, slug: 'list-org' },
      role: 'owner',
    });
    await ensureDefaultTeamForOrg(auth, org.id);
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const res = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      headers: bearer(ownerKey.key),
    });
    expect(res.status).toBe(200);
    const body = await parseJson<{ workspaces: { id: string; name: string }[] }>(res);
    expect(body.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(body.workspaces[0]!.name).toBe('General');
  });

  it('404s for unknown org', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Other' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9002',
      org: { id: org.id, name: org.name, slug: 'other' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const res = await app.request(`/api/v1/orgs/${randomUUID()}/workspaces`, {
      headers: bearer(ownerKey.key),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/orgs/:orgId/workspaces (REQ-A2)', () => {
  it('owner can create a workspace', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Create Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9003',
      org: { id: org.id, name: org.name, slug: 'create-org' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const res = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fiji TV' }),
    });
    expect(res.status).toBe(201);
    const body = await parseJson<{ id: string; name: string }>(res);
    expect(body.name).toBe('Fiji TV');
    expect(typeof body.id).toBe('string');
  });

  it('member cannot create a workspace → 403', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Member Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'member@example.com',
      name: 'Member',
      githubAccountId: '9004',
      org: { id: org.id, name: org.name, slug: 'member-org' },
      role: 'member',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const res = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects empty name → 400', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Bad Name' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9005',
      org: { id: org.id, name: org.name, slug: 'bad-name' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const res = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/orgs/:orgId/agent-keys team_id (REQ-A3)', () => {
  it('owner mints workspace-scoped key → 200 with team_id', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Mint Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9006',
      org: { id: org.id, name: org.name, slug: 'mint-org' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    // Create a workspace via the API.
    const createRes = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Engineering' }),
    });
    const workspace = await parseJson<{ id: string; name: string }>(createRes);

    // Create a project in that workspace.
    const project = await createProject(db, { name: 'Board', orgId: org.id, workspaceId: workspace.id });

    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: workspace.id, name: 'plandesk connect' }),
    });
    expect(res.status).toBe(200);
    const body = await parseJson<{ token: string; team_id: string }>(res);
    expect(body.team_id).toBe(workspace.id);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    const verified = await verifyBetterAuthApiKey(auth, body.token);
    expect(verified).toBeDefined();
    expect(verified?.metadata).toEqual({ orgId: org.id, teamId: workspace.id });

    // Scoped key works on project in workspace.
    const onA = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      headers: bearer(body.token),
    });
    expect(onA.status).toBe(200);

    // Create a project outside the workspace and verify 404.
    const otherProject = await createProject(db, { name: 'Other', orgId: org.id });
    const onB = await app.request(`/api/v1/projects/${otherProject.id}/tasks`, {
      headers: bearer(body.token),
    });
    expect(onB.status).toBe(404);
  });

  it('rejects both project_id and team_id → 400', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Both Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9007',
      org: { id: org.id, name: org.name, slug: 'both-org' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'p1', team_id: 't1' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects team_id in another org → 404', async () => {
    const { app, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9008',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: orgA.id, name: 'owner' });

    // Seed a team in orgB by creating a workspace via orgB's owner.
    const { userId: userIdB } = await seedBetterAuthUser(auth, {
      email: 'owner-b@example.com',
      name: 'Owner B',
      githubAccountId: '9009',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userIdB, orgId: orgB.id, name: 'owner-b' });
    const createRes = await app.request(`/api/v1/orgs/${orgB.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Secret' }),
    });
    const workspaceB = await parseJson<{ id: string }>(createRes);

    const res = await app.request(`/api/v1/orgs/${orgA.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: workspaceB.id }),
    });
    expect(res.status).toBe(404);
  });
});
