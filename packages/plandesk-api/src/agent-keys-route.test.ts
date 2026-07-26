import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import {
  createDb,
  createTaskWithDefaultGoal as createTask,
  migrate,
  type Db,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import {
  createOrgOwnerKey,
  createScopedAgentKey,
  verifyBetterAuthApiKey,
} from './agent-keys.js';
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

describe('POST /api/v1/orgs/:orgId/agent-keys (BA4b-3)', () => {
  it('gate 1: owner key mints scoped agent key → 200 { token, project_id }; agent profile cannot mint tokens', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Mint Org' };
    const project = await createProject(db, { name: 'Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '8301',
      org: { id: org.id, name: org.name, slug: 'mint-org' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'cli-owner',
    });

    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'plandesk connect' }),
    });
    expect(res.status).toBe(200);
    const body = await parseJson<{ token: string; project_id: string }>(res);
    expect(body.project_id).toBe(project.id);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    const verified = await verifyBetterAuthApiKey(auth, body.token);
    expect(verified).toBeDefined();
    expect(verified?.metadata).toEqual({ projectId: project.id, orgId: org.id });

    // Agent profile: apiKey stripped — cannot mint further keys.
    const escalate = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'must-fail' }),
    });
    expect(escalate.status).toBe(403);
    expect(await parseJson(escalate)).toEqual({ error: 'forbidden' });
  });

  it('gate 2 / test:cross_org_denied — project_id in another org → 404', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const projectB = await createProject(db, { name: 'Other Board', orgId: orgB.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'A',
      githubAccountId: '8302',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({
      auth,
      userId,
      orgId: orgA.id,
      name: 'owner-a',
    });

    const res = await app.request(`/api/v1/orgs/${orgA.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectB.id }),
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('gate 3: scoped agent key cannot provision agent keys → 403', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'No Esc' };
    const project = await createProject(db, { name: 'Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'agent@example.com',
      name: 'AgentOwner',
      githubAccountId: '8303',
      org: { id: org.id, name: org.name, slug: 'no-esc' },
      role: 'owner',
    });
    const agentKey = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      name: 'existing-agent',
    });

    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(agentKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id }),
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });

  it('gate 3b: session member cannot mint agent keys → 403', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Member Org' };
    const project = await createProject(db, { name: 'Board', orgId: org.id });
    const { cookie } = await seedBetterAuthUser(auth, {
      email: 'member@example.com',
      name: 'Member',
      githubAccountId: '8304',
      org: { id: org.id, name: org.name, slug: 'member-org' },
      role: 'member',
    });

    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id }),
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });

  it('minted agent key authorizes project work and 404s on another project', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Scope Org' };
    const projectA = await createProject(db, { name: 'A', orgId: org.id });
    const projectB = await createProject(db, { name: 'B', orgId: org.id });
    await createTask(db, { projectId: projectA.id, label: 'T', status: 'todo' });
    await createTask(db, { projectId: projectB.id, label: 'U', status: 'todo' });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'scope@example.com',
      name: 'Scope',
      githubAccountId: '8305',
      org: { id: org.id, name: org.name, slug: 'scope-org' },
      role: 'owner',
    });
    const ownerKey = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'owner',
    });

    const mint = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(ownerKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectA.id }),
    });
    expect(mint.status).toBe(200);
    const { token } = await parseJson<{ token: string }>(mint);

    const onA = await app.request(`/api/v1/projects/${projectA.id}/tasks`, {
      headers: bearer(token),
    });
    expect(onA.status).toBe(200);

    const onB = await app.request(`/api/v1/projects/${projectB.id}/tasks`, {
      headers: bearer(token),
    });
    expect(onB.status).toBe(404);
  });
});
