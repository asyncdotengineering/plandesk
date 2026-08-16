import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import { createDb, createTaskWithDefaultGoal as createTask, migrate, type Db } from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import { createOrgOwnerKey, verifyBetterAuthApiKey } from './agent-keys.js';
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

describe('POST /api/v1/auth/cli-token (BA4b-2)', () => {
  it('gate 1: session owner mints owner key → 200 { token, org_id, org_name }; metadata kind owner, no projectId', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'CLI Org' };
    const { cookie } = await seedBetterAuthUser(auth, {
      email: 'owner@example.com',
      name: 'Owner',
      githubAccountId: '7201',
      org: { id: org.id, name: org.name, slug: 'cli-org' },
      role: 'owner',
    });

    const res = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My CLI' }),
    });
    expect(res.status).toBe(200);
    const body = await parseJson<{ token: string; org_id: string; org_name: string }>(res);
    expect(body.org_id).toBe(org.id);
    expect(body.org_name).toBe('CLI Org');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    const verified = await verifyBetterAuthApiKey(auth, body.token);
    expect(verified).toBeDefined();
    expect(verified?.valid).toBe(true);
    expect(verified?.metadata).toEqual({ orgId: org.id, kind: 'owner' });
    expect(
      verified?.metadata !== null &&
        typeof verified?.metadata === 'object' &&
        'projectId' in verified.metadata,
    ).toBe(false);
  });

  it('gate 2: session member (non-owner) → 403 apiKey:create denied', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Member Org' };
    const { cookie } = await seedBetterAuthUser(auth, {
      email: 'member@example.com',
      name: 'Member',
      githubAccountId: '7202',
      org: { id: org.id, name: org.name, slug: 'member-org' },
      role: 'member',
    });

    const res = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(await parseJson(res)).toEqual({ error: 'forbidden' });
  });

  it('gate 3a: apikey owner Bearer cannot mint via this endpoint → 401', async () => {
    const { app, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Key Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'keyowner@example.com',
      name: 'KeyOwner',
      githubAccountId: '7203',
      org: { id: org.id, name: org.name, slug: 'key-org' },
      role: 'owner',
    });
    const minted = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'existing-owner',
    });

    const res = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });

  it('gate 3b: stranger mcp_token Bearer cannot mint via this endpoint → 401', async () => {
    const { app } = await hostedApp();

    const res = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { ...bearer('plandesk_mcp_not-a-real-token'), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });

  it('gate 3c: loopback reports that no token is required', async () => {
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
      bindHost: '127.0.0.1',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    });

    const res = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'loopback_no_token_required' });
  });

  it('gate 4: minted owner token authorizes org write and reaches second project', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Write Org' };
    const projectA = await createProject(db, { name: 'Board A', orgId: org.id });
    const projectB = await createProject(db, { name: 'Board B', orgId: org.id });
    await createTask(db, {
      projectId: projectA.id,
      label: 'Existing',
      status: 'todo',
    });

    const { cookie } = await seedBetterAuthUser(auth, {
      email: 'writer@example.com',
      name: 'Writer',
      githubAccountId: '7204',
      org: { id: org.id, name: org.name, slug: 'write-org' },
      role: 'owner',
    });

    const mint = await app.request('/api/v1/auth/cli-token', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CLI write' }),
    });
    expect(mint.status).toBe(200);
    const { token, org_id } = await parseJson<{ token: string; org_id: string }>(mint);
    expect(org_id).toBe(org.id);

    // CLI paste-path: GET /auth/session with Bearer resolves org.
    const session = await parseJson<{ kind: string; org: { id: string; name: string } }>(
      await app.request('/api/v1/auth/session', { headers: bearer(token) }),
    );
    expect(session.kind).toBe('apikey');
    expect(session.org.id).toBe(org.id);

    // Org write on project A.
    const createOnA = await app.request(`/api/v1/projects/${projectA.id}/tasks`, {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'From CLI key' }),
    });
    expect(createOnA.status).toBe(201);

    // Org-wide: second project is reachable.
    const readB = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: bearer(token),
    });
    expect(readB.status).toBe(200);

    const createOnB = await app.request(`/api/v1/projects/${projectB.id}/tasks`, {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'On B' }),
    });
    expect(createOnB.status).toBe(201);
  });
});
