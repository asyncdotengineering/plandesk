import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import {
  DEFAULT_ORG_ID,
  createAgentRun,
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
import { createApp } from './server.js';
import { parseJson } from './test-helpers.js';

/**
 * Role-differentiated HTTP coverage of the better-auth permission ceiling.
 * External matrix (do not re-derive from access-control.ts):
 *   member/admin/owner × resource:action at real mutating routes.
 * Deny shape: PermissionDeniedError → { error: 'forbidden' } status 403
 * (server.ts onError).
 */

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';
const FORBIDDEN = { error: 'forbidden' } as const;

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

function jsonHeaders(cookie: string): HeadersInit {
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

async function expectForbidden(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(await parseJson(res)).toEqual(FORBIDDEN);
}

/** Seed member/admin/owner in one org + a board with task, document, agent run. */
async function seedMatrix() {
  const { app, db, auth } = await hostedBetterAuthApp();
  const org = { id: randomUUID(), name: 'Role Matrix' };
  const orgRef = { id: org.id, name: org.name, slug: 'role-matrix' };

  const member = await seedBetterAuthUser(auth, {
    email: 'member@example.com',
    name: 'Member',
    githubAccountId: '9101',
    org: orgRef,
    role: 'member',
  });
  const admin = await seedBetterAuthUser(auth, {
    email: 'admin@example.com',
    name: 'Admin',
    githubAccountId: '9102',
    org: orgRef,
    role: 'admin',
  });
  const owner = await seedBetterAuthUser(auth, {
    email: 'owner@example.com',
    name: 'Owner',
    githubAccountId: '9103',
    org: orgRef,
    role: 'owner',
  });

  const projectRes = await app.request('/api/v1/projects', {
    method: 'POST',
    headers: jsonHeaders(owner.cookie),
    body: JSON.stringify({ name: 'Matrix Board' }),
  });
  expect(projectRes.status).toBe(201);
  const project = await parseJson<{ id: string }>(projectRes);

  const taskRes = await app.request(`/api/v1/projects/${project.id}/tasks`, {
    method: 'POST',
    headers: jsonHeaders(owner.cookie),
    body: JSON.stringify({ label: 'Seed task' }),
  });
  expect(taskRes.status).toBe(201);
  const task = await parseJson<{ id: string }>(taskRes);

  const docRes = await app.request(`/api/v1/projects/${project.id}/documents`, {
    method: 'POST',
    headers: jsonHeaders(owner.cookie),
    body: JSON.stringify({ title: 'Seed doc' }),
  });
  expect(docRes.status).toBe(201);
  const document = await parseJson<{ id: string }>(docRes);

  // agent_run:create has no HTTP route (MCP start_agent_run only). Seed via db
  // so agent_run:update can be exercised over POST /agent-runs/:id/progress.
  const agentRun = await createAgentRun(db, { projectId: project.id, label: 'Seed run' });

  return { app, db, org, member, admin, owner, project, task, document, agentRun };
}

describe('role permission matrix (ba-hardening)', () => {
  // ── Gate 1: member ALLOW task:update; DENY elevated ──────────────────────

  it('member allows task:update', async () => {
    const { app, member, task } = await seedMatrix();
    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(member.cookie),
      body: JSON.stringify({ label: 'Member edited' }),
    });
    expect(res.status).toBe(200);
    expect((await parseJson<{ label: string }>(res)).label).toBe('Member edited');
  });

  it('member denies project:create', async () => {
    const { app, member } = await seedMatrix();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(member.cookie),
      body: JSON.stringify({ name: 'Should Fail' }),
    });
    await expectForbidden(res);
  });

  it('member denies project:delete', async () => {
    const { app, member, project } = await seedMatrix();
    const res = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'DELETE',
      headers: { Cookie: member.cookie },
    });
    await expectForbidden(res);
  });

  it('member denies organization:update', async () => {
    const { app, member, org } = await seedMatrix();
    // requirePermission runs before body parse (routes/orgs.ts import).
    const res = await app.request(`/api/v1/orgs/${org.id}/import`, {
      method: 'POST',
      headers: jsonHeaders(member.cookie),
      body: JSON.stringify({}),
    });
    await expectForbidden(res);
  });

  it('member denies invitation:create (invitations)', async () => {
    const { app, member, org } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(member.cookie),
      body: JSON.stringify({ email: 'member-deny@example.com', role: 'member' }),
    });
    await expectForbidden(res);
  });

  it('member denies apiKey:create (agent-keys)', async () => {
    const { app, member, org, project } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: jsonHeaders(member.cookie),
      body: JSON.stringify({ project_id: project.id, name: 'should-fail' }),
    });
    await expectForbidden(res);
  });

  // ── Gate 2: admin ALLOW project create/delete; DENY owner-only ───────────

  it('admin allows project:create', async () => {
    const { app, admin } = await seedMatrix();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ name: 'Admin Board' }),
    });
    expect(res.status).toBe(201);
  });

  it('admin allows project:delete', async () => {
    const { app, admin } = await seedMatrix();
    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ name: 'To Delete' }),
    });
    expect(created.status).toBe(201);
    const { id } = await parseJson<{ id: string }>(created);
    const res = await app.request(`/api/v1/projects/${id}`, {
      method: 'DELETE',
      headers: { Cookie: admin.cookie },
    });
    expect(res.status).toBe(204);
  });

  it('admin denies organization:update', async () => {
    const { app, admin, org } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/import`, {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({}),
    });
    await expectForbidden(res);
  });

  it('admin allows invitation:create (invite member and admin)', async () => {
    const { app, admin, org } = await seedMatrix();
    const asMember = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ email: 'admin-invites-member@example.com', role: 'member' }),
    });
    expect(asMember.status).toBe(201);
    // Admins may also invite other admins (better-auth only blocks non-owners
    // inviting owners).
    const asAdmin = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ email: 'admin-invites-admin@example.com', role: 'admin' }),
    });
    expect(asAdmin.status).toBe(201);
  });

  it('admin denies inviting an owner (better-auth creatorRole guard)', async () => {
    const { app, admin, org } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ email: 'admin-invites-owner@example.com', role: 'owner' }),
    });
    await expectForbidden(res);
  });

  it('admin denies apiKey:create (agent-keys)', async () => {
    const { app, admin, org, project } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ project_id: project.id, name: 'should-fail' }),
    });
    await expectForbidden(res);
  });

  // ── Gate 3: owner ALLOW all elevated + content ───────────────────────────

  it('owner allows project:create', async () => {
    const { app, owner } = await seedMatrix();
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ name: 'Owner Board' }),
    });
    expect(res.status).toBe(201);
  });

  it('owner allows project:delete', async () => {
    const { app, owner } = await seedMatrix();
    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ name: 'Owner Delete' }),
    });
    const { id } = await parseJson<{ id: string }>(created);
    const res = await app.request(`/api/v1/projects/${id}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(204);
  });

  it('owner allows organization:update (gate passes; body may fail validation)', async () => {
    const { app, owner, org } = await seedMatrix();
    // Permission checked before body validation — 400 (not 403) proves ALLOW.
    const res = await app.request(`/api/v1/orgs/${org.id}/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(403);
  });

  it('owner allows member:create (invitations)', async () => {
    const { app, owner, org } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ email: 'invitee@example.com', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = await parseJson<{ invitationId: string; claimUrl: string }>(res);
    expect(typeof body.invitationId).toBe('string');
    expect(typeof body.claimUrl).toBe('string');
  });

  it('owner allows apiKey:create (agent-keys)', async () => {
    const { app, owner, org, project } = await seedMatrix();
    const res = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ project_id: project.id, name: 'owner-key' }),
    });
    expect(res.status).toBe(200);
    const body = await parseJson<{ token: string; project_id: string }>(res);
    expect(body.project_id).toBe(project.id);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  it('owner allows task:update', async () => {
    const { app, owner, task } = await seedMatrix();
    const res = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ label: 'Owner edited' }),
    });
    expect(res.status).toBe(200);
  });

  // ── Gate 4: content perms ALLOW for member, admin, owner ─────────────────

  it.each(['member', 'admin', 'owner'] as const)(
    '%s allows document:create',
    async (role) => {
      const ctx = await seedMatrix();
      const cookie = ctx[role].cookie;
      const res = await ctx.app.request(`/api/v1/projects/${ctx.project.id}/documents`, {
        method: 'POST',
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ title: `${role} doc` }),
      });
      expect(res.status).toBe(201);
    },
  );

  it.each(['member', 'admin', 'owner'] as const)(
    '%s allows comment:create',
    async (role) => {
      const ctx = await seedMatrix();
      const cookie = ctx[role].cookie;
      const res = await ctx.app.request(`/api/v1/tasks/${ctx.task.id}/comments`, {
        method: 'POST',
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ body: `${role} comment` }),
      });
      expect(res.status).toBe(201);
    },
  );

  // agent_run:create has no reachable HTTP route (MCP start_agent_run only).
  // Exercise agent_run:update via progress — same workActions set for all three roles.
  it.each(['member', 'admin', 'owner'] as const)(
    '%s allows agent_run:update (create has no HTTP route; update is the HTTP gate)',
    async (role) => {
      const ctx = await seedMatrix();
      const cookie = ctx[role].cookie;
      const res = await ctx.app.request(`/api/v1/agent-runs/${ctx.agentRun.id}/progress`, {
        method: 'POST',
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ message: `${role} progress` }),
      });
      expect(res.status).toBe(201);
    },
  );
});
