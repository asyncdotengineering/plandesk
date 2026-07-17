import { describe, expect, it } from 'vitest';
import {
  createOrg,
  createProject,
  createTaskWithDefaultGoal as createTask,
  ensureDefaultOrg,
  migrate,
  createDb,
} from '@plandesk/db';
import {
  createBetterAuth,
  createOrgOwnerKey,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './index.js';
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

async function seedOwner(
  auth: BetterAuthInstance,
  org: { id: string; name: string; slug: string },
  email: string,
  githubAccountId: string,
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: email,
      email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthAccount>({
    model: 'account',
    data: {
      accountId: githubAccountId,
      providerId: 'github',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  const existingOrg = await adapter.findOne<BetterAuthOrganization>({
    model: 'organization',
    where: [{ field: 'id', value: org.id }],
  });
  if (existingOrg === null) {
    const orgData = {
      id: org.id,
      name: org.name,
      slug: org.slug,
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
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    },
  });
  return user.id;
}

describe('org tenancy', () => {
  it('test:cross_org_denied — org-B key requesting org-A project returns 404 on REST', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await ensureDefaultOrg(db);
    const orgA = await createOrg(db, { name: 'Org A' });
    const orgB = await createOrg(db, { name: 'Org B' });
    const projectA = await createProject(db, { name: 'A Project', orgId: orgA.id });

    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const userB = await seedOwner(
      auth,
      { id: orgB.id, name: orgB.name, slug: 'org-b' },
      'b@example.com',
      '9001',
    );
    const keyB = await createOrgOwnerKey({
      auth,
      userId: userB,
      orgId: orgB.id,
      name: 'b-key',
    });

    const app = createApp({
      db,
      bindHost: '0.0.0.0',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
      github: {
        clientId: 'c',
        clientSecret: 's',
        callbackUrl: 'https://x.test/cb',
      },
    });

    const res = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Authorization: `Bearer ${keyB.key}` },
    });
    expect(res.status).toBe(404);
    expect(await parseJson(res)).toEqual({ error: 'not_found' });
  });

  it('test:local_mode_unchanged — loopback single-org works without a token', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await ensureDefaultOrg(db);
    const app = createApp({
      db,
      bindHost: '127.0.0.1',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    });

    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local Project' }),
    });
    expect(createRes.status).toBe(201);
    const created = await parseJson<{ id: string; name: string }>(createRes);
    expect(created.name).toBe('Local Project');

    const listRes = await app.request('/api/v1/projects');
    expect(listRes.status).toBe(200);
    const listed = await parseJson<Array<{ id: string }>>(listRes);
    expect(listed.some((p) => p.id === created.id)).toBe(true);

    const getRes = await app.request(`/api/v1/projects/${created.id}`);
    expect(getRes.status).toBe(200);
  });

  it('requires a credential when bound to non-loopback even with a single org', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await ensureDefaultOrg(db);
    const app = createApp({
      db,
      bindHost: '0.0.0.0',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    });
    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });

  it('claim with org-B key on org-A task returns not-claimed (tenancy)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    await ensureDefaultOrg(db);
    const orgA = await createOrg(db, { name: 'Org A' });
    const orgB = await createOrg(db, { name: 'Org B' });
    const projectA = await createProject(db, { name: 'A Project', orgId: orgA.id });
    const task = await createTask(db, {
      projectId: projectA.id,
      label: 'A task',
      status: 'todo',
    });

    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const userB = await seedOwner(
      auth,
      { id: orgB.id, name: orgB.name, slug: 'org-b' },
      'claim-b@example.com',
      '9002',
    );
    const keyB = await createOrgOwnerKey({
      auth,
      userId: userB,
      orgId: orgB.id,
      name: 'b-key',
    });

    const app = createApp({
      db,
      bindHost: '0.0.0.0',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
      github: {
        clientId: 'c',
        clientSecret: 's',
        callbackUrl: 'https://x.test/cb',
      },
    });

    const res = await app.request(`/api/v1/tasks/${task.id}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keyB.key}`,
      },
      body: JSON.stringify({ agent_ref: 'agent-b' }),
    });
    expect(res.status).toBe(409);
    expect(await parseJson(res)).toEqual({
      claimed: false,
      reason: 'taken_or_not_actionable',
    });
  });
});
