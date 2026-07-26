import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
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
  createWorkspaceScopedAgentKey,
  DEFAULT_AGENT_KEY_PERMISSIONS,
} from './agent-keys.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { createApp } from './server.js';
import { createTestApp, parseJson } from './test-helpers.js';
import { readApiKeyMetadata } from './auth.js';

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

describe('workspace-scoped agent keys (cross-workspace isolation)', () => {
  it('1: workspace-scoped key can read and list its own workspace projects', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'WS Org' };
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', orgId: org.id, workspaceId: wsA });
    await createProject(db, { name: 'Project B', orgId: org.id, workspaceId: wsB });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'ws@example.com',
      name: 'WS',
      githubAccountId: '7001',
      org: { id: org.id, name: org.name, slug: 'ws' },
      role: 'owner',
    });

    const keyA = await createWorkspaceScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'ws-a-agent',
    });

    // Read project in workspace A
    const getA = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: bearer(keyA.key),
    });
    expect(getA.status).toBe(200);

    // List returns only workspace A
    const listRes = await app.request('/api/v1/projects', {
      headers: bearer(keyA.key),
    });
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string; name: string }>>(listRes);
    expect(listed.some((p) => p.id === projectA.id)).toBe(true);
    expect(listed.every((p) => p.name === 'Project A')).toBe(true);
  });

  it('2: same workspace key on different workspace in same org → 404; list omits sibling workspace', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'WS2 Org' };
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', orgId: org.id, workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Project B', orgId: org.id, workspaceId: wsB });
    const taskB = await createTask(db, {
      projectId: projectB.id,
      label: 'On B',
      status: 'todo',
    });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'ws2@example.com',
      name: 'WS2',
      githubAccountId: '7002',
      org: { id: org.id, name: org.name, slug: 'ws2' },
      role: 'owner',
    });

    const keyA = await createWorkspaceScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'ws-a-agent',
    });

    // GET project B → 404
    const getB = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: bearer(keyA.key),
    });
    expect(getB.status).toBe(404);
    expect(await parseJson(getB)).toEqual({ error: 'not_found' });

    // PATCH task in project B → 404 (no leak)
    const patchB = await app.request(`/api/v1/tasks/${taskB.id}`, {
      method: 'PATCH',
      headers: { ...bearer(keyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Leak' }),
    });
    expect(patchB.status).toBe(404);
    expect(await parseJson(patchB)).toEqual({ error: 'not_found' });

    // List returns only workspace A
    const listRes = await app.request('/api/v1/projects', {
      headers: bearer(keyA.key),
    });
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string; name: string }>>(listRes);
    expect(listed.some((p) => p.id === projectA.id)).toBe(true);
    expect(listed.some((p) => p.id === projectB.id)).toBe(false);
  });

  it('3: owner key (no teamId/projectId) reads projects across both workspaces', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Owner WS Org' };
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', orgId: org.id, workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Project B', orgId: org.id, workspaceId: wsB });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'owner-ws@example.com',
      name: 'OwnerWS',
      githubAccountId: '7003',
      org: { id: org.id, name: org.name, slug: 'owner-ws' },
      role: 'owner',
    });

    const ownerKey = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'owner-key',
    });

    // Read both projects
    const getA = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: bearer(ownerKey.key),
    });
    expect(getA.status).toBe(200);

    const getB = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: bearer(ownerKey.key),
    });
    expect(getB.status).toBe(200);

    // List returns both
    const listRes = await app.request('/api/v1/projects', {
      headers: bearer(ownerKey.key),
    });
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string }>>(listRes);
    expect(listed.some((p) => p.id === projectA.id)).toBe(true);
    expect(listed.some((p) => p.id === projectB.id)).toBe(true);
  });

  it('4: project-scoped key is still narrow to its one project (regression)', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Proj WS Org' };
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', orgId: org.id, workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Project B', orgId: org.id, workspaceId: wsB });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'proj-ws@example.com',
      name: 'ProjWS',
      githubAccountId: '7004',
      org: { id: org.id, name: org.name, slug: 'proj-ws' },
      role: 'owner',
    });

    const keyA = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: projectA.id,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'proj-a-agent',
    });

    // Can read own project
    const getA = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: bearer(keyA.key),
    });
    expect(getA.status).toBe(200);

    // Cannot read project B
    const getB = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: bearer(keyA.key),
    });
    expect(getB.status).toBe(404);
    expect(await parseJson(getB)).toEqual({ error: 'not_found' });
  });

  it('5: readApiKeyMetadata maps teamId → workspaceId; key with neither → both undefined', () => {
    expect(
      readApiKeyMetadata({ orgId: 'o1', teamId: 't1' }),
    ).toEqual({ orgId: 'o1', projectId: undefined, workspaceId: 't1', kind: 'agent' });

    expect(
      readApiKeyMetadata({ orgId: 'o1', projectId: 'p1' }),
    ).toEqual({ orgId: 'o1', projectId: 'p1', workspaceId: undefined, kind: 'agent' });

    expect(
      readApiKeyMetadata({ orgId: 'o1', kind: 'owner' }),
    ).toEqual({ orgId: 'o1', projectId: undefined, workspaceId: undefined, kind: 'owner' });

    expect(readApiKeyMetadata(null)).toEqual({
      orgId: undefined,
      projectId: undefined,
      workspaceId: undefined,
      kind: 'agent',
    });
  });
});

describe('loopback workspace scoping (local convenience)', () => {
  it('loopback with x-plandesk-workspace-id header lists only that workspace', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', workspaceId: wsA });
    await createProject(db, { name: 'Project B', workspaceId: wsB });

    const listRes = await app.request('/api/v1/projects', {
      headers: { 'x-plandesk-workspace-id': wsA },
    });
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string; name: string }>>(listRes);
    expect(listed.some((p) => p.id === projectA.id)).toBe(true);
    expect(listed.every((p) => p.name === 'Project A')).toBe(true);
  });

  it('loopback with header → cross-workspace project GET → 404', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const wsB = randomUUID();
    await createProject(db, { name: 'Project A', workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Project B', workspaceId: wsB });

    const getB = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: { 'x-plandesk-workspace-id': wsA },
    });
    expect(getB.status).toBe(404);
    expect(await parseJson(getB)).toEqual({ error: 'not_found' });
  });

  it('loopback without header → all projects (owner)', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', workspaceId: wsA });
    const projectB = await createProject(db, { name: 'Project B', workspaceId: wsB });

    const listRes = await app.request('/api/v1/projects');
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string }>>(listRes);
    expect(listed.some((p) => p.id === projectA.id)).toBe(true);
    expect(listed.some((p) => p.id === projectB.id)).toBe(true);
  });

  it('hosted apikey context ignores the workspace header (privilege bug prevention)', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Header Ignore Org' };
    const wsA = randomUUID();
    const wsB = randomUUID();
    const projectA = await createProject(db, { name: 'Project A', orgId: org.id, workspaceId: wsA });
    await createProject(db, { name: 'Project B', orgId: org.id, workspaceId: wsB });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'header-ignore@example.com',
      name: 'HeaderIgnore',
      githubAccountId: '7005',
      org: { id: org.id, name: org.name, slug: 'header-ignore' },
      role: 'owner',
    });

    const ownerKey = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'owner-key',
    });

    // Owner key (no workspaceId in metadata) should see ALL projects regardless of header
    const listRes = await app.request('/api/v1/projects', {
      headers: { ...bearer(ownerKey.key), 'x-plandesk-workspace-id': wsA },
    });
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string }>>(listRes);
    expect(listed.some((p) => p.id === projectA.id)).toBe(true);
  });
});
