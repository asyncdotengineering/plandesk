import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDb,
  createProjectInDefaultOrg as createProject,
  migrate,
  type Db,
} from '@plandesk/db';
import type { Hono } from 'hono';
import {
  createOrgOwnerKey,
  createWorkspaceScopedAgentKey,
} from '../agent-keys.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from '../better-auth.js';
import { ensureDefaultTeamForOrg } from '../identity.js';
import { createApp } from '../server.js';
import { parseJson, type ProjectResponse } from '../test-helpers.js';

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

  return { userId: user.id };
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

describe('PATCH /api/v1/projects/:id { workspace_id } (move project, REQ-A2)', () => {
  it('serializeProject includes workspace_id; owner moves a project between workspaces', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Move Org', slug: 'move-org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9101',
      org,
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    // Ensure the default team exists, then create a second workspace via the API.
    const defaultTeamId = await ensureDefaultTeamForOrg(auth, org.id);
    const createWsRes = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fiji TV' }),
    });
    const fiji = await parseJson<{ id: string; name: string }>(createWsRes);

    // Project starts in the default workspace.
    const project = await createProject(db, {
      name: 'OTT Mobile',
      orgId: org.id,
      workspaceId: defaultTeamId,
    });

    // REQ-A1: the serialized project carries workspace_id.
    const beforeRes = await app.request(`/api/v1/projects/${project.id}`, {
      headers: bearer(ownerKey.key),
    });
    const before = await parseJson<ProjectResponse>(beforeRes);
    expect(before.workspace_id).toBe(defaultTeamId);

    // Move it into the Fiji TV workspace.
    const moveRes = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: fiji.id }),
    });
    expect(moveRes.status).toBe(200);
    const moved = await parseJson<ProjectResponse>(moveRes);
    expect(moved.workspace_id).toBe(fiji.id);
    expect(moved.id).toBe(project.id);
  });

  it('moving to a team in another org → 404', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A', slug: 'org-a' };
    const orgB = { id: randomUUID(), name: 'Org B', slug: 'org-b' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner-a@example.com',
      name: 'Owner A',
      githubAccountId: '9102',
      org: orgA,
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: orgA.id, name: 'owner-a' });

    const defaultTeamId = await ensureDefaultTeamForOrg(auth, orgA.id);
    const project = await createProject(db, {
      name: 'Project A',
      orgId: orgA.id,
      workspaceId: defaultTeamId,
    });

    // Seed a workspace in orgB (out of the caller's reach).
    const { userId: userIdB } = await seedBetterAuthUser(auth, {
      email: 'owner-b@example.com',
      name: 'Owner B',
      githubAccountId: '9103',
      org: orgB,
      role: 'owner',
    });
    const ownerKeyB = await createOrgOwnerKey({
      auth,
      userId: userIdB,
      orgId: orgB.id,
      name: 'owner-b',
    });
    const wsBRes = await app.request(`/api/v1/orgs/${orgB.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Secret' }),
    });
    const workspaceB = await parseJson<{ id: string }>(wsBRes);

    const res = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceB.id }),
    });
    expect(res.status).toBe(404);
  });

  it('a workspace-scoped agent key cannot move a project → 403', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Scoped Org', slug: 'scoped-org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '9104',
      org,
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({ auth, userId, orgId: org.id, name: 'owner' });

    const defaultTeamId = await ensureDefaultTeamForOrg(auth, org.id);
    const wsRes = await app.request(`/api/v1/orgs/${org.id}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Engineering' }),
    });
    const engineering = await parseJson<{ id: string }>(wsRes);

    // Project lives in the Engineering workspace.
    const project = await createProject(db, {
      name: 'Board',
      orgId: org.id,
      workspaceId: engineering.id,
    });

    // Mint a workspace-scoped key for Engineering.
    const scoped = await createWorkspaceScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      teamId: engineering.id,
      name: 'connect',
    });

    const res = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: { ...bearer(scoped.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: defaultTeamId }),
    });
    expect([403, 404]).toContain(res.status);
  });
});
