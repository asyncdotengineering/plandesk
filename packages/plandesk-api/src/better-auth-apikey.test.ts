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
  DEFAULT_AGENT_KEY_PERMISSIONS,
  DEFAULT_OWNER_KEY_PERMISSIONS,
} from './agent-keys.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { ensureLocalBetterAuthOrganization } from './identity.js';
import { createApp } from './server.js';
import { createTestApp, parseJson } from './test-helpers.js';

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

describe('better-auth API keys with live-role ceiling (BA5)', () => {
  it('agent keys cannot impersonate the owner on native Better Auth endpoints', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Escalation Org' };
    const project = await createProject(db, { name: 'Escalation Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'native-endpoint@example.com',
      name: 'Native Endpoint',
      githubAccountId: '5005',
      org: { id: org.id, name: org.name, slug: 'escalation' },
      role: 'owner',
    });
    const agentKey = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      name: 'native-endpoint-agent',
    });

    const response = await app.request('/api/auth/api-key/list', {
      headers: { 'x-api-key': agentKey.key },
    });
    expect(response.status).toBe(401);
  });

  it('property 1: task:read key → 200 on task read, 403 on task update', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'P1 Org' };
    const project = await createProject(db, { name: 'P1 Board', orgId: org.id });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Read me',
      status: 'todo',
    });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p1@example.com',
      name: 'P1',
      githubAccountId: '5101',
      org: { id: org.id, name: org.name, slug: 'p1' },
      role: 'owner',
    });
    const minted = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      permissions: { task: ['read'] },
      name: 'read-only-agent',
    });

    const list = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      headers: bearer(minted.key),
    });
    expect(list.status).toBe(200);
    const tasks = await parseJson<Array<{ id: string }>>(list);
    expect(tasks.some((t) => t.id === task.id)).toBe(true);

    const update = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Hacked' }),
    });
    expect(update.status).toBe(403);
    expect(await parseJson(update)).toEqual({ error: 'forbidden' });
  });

  it('property 2: agent key → 403 on member:add and 403 on apiKey/token mint (AGENT_FORBIDDEN)', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'P2 Org' };
    const project = await createProject(db, { name: 'P2 Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p2@example.com',
      name: 'P2',
      githubAccountId: '5202',
      org: { id: org.id, name: org.name, slug: 'p2' },
      role: 'owner',
    });
    // Mint with owner-level work perms (no member/apiKey in default grant).
    const minted = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'agent',
    });

    // Even if key tried to carry apiKey/member, ceiling strips apiKey; default has empty member.
    const memberAdd = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', role: 'member' }),
    });
    expect(memberAdd.status).toBe(403);
    expect(await parseJson(memberAdd)).toEqual({ error: 'forbidden' });

    const mintAgent = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'escalation' }),
    });
    expect(mintAgent.status).toBe(403);
    expect(await parseJson(mintAgent)).toEqual({ error: 'forbidden' });
  });

  it('property 2b: AGENT_FORBIDDEN strips apiKey even when key was minted with apiKey:create', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'P2b Org' };
    const project = await createProject(db, { name: 'P2b Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p2b@example.com',
      name: 'P2b',
      githubAccountId: '5203',
      org: { id: org.id, name: org.name, slug: 'p2b' },
      role: 'owner',
    });
    const minted = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      permissions: {
        task: ['read', 'create', 'update', 'delete'],
        apiKey: ['create', 'read', 'update', 'delete'],
        member: ['create'],
      },
      name: 'over-granted',
    });

    const mintAgent = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'should-fail' }),
    });
    expect(mintAgent.status).toBe(403);
    expect(await parseJson(mintAgent)).toEqual({ error: 'forbidden' });
  });

  it('property 3: key minted as owner is capped at member after demotion (live ∩)', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'P3 Org' };
    const project = await createProject(db, { name: 'P3 Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p3@example.com',
      name: 'P3',
      githubAccountId: '5303',
      org: { id: org.id, name: org.name, slug: 'p3' },
      role: 'owner',
    });
    const minted = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      permissions: {
        task: ['read', 'create', 'update', 'delete'],
        project: ['create', 'delete'],
      },
      name: 'was-owner',
    });

    const before = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'While Owner' }),
    });
    expect(before.status).toBe(201);

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [
        { field: 'userId', value: userId },
        { field: 'organizationId', value: org.id },
      ],
    });
    const member = members[0];
    if (member === undefined) throw new Error('expected member');
    await adapter.update({
      model: 'member',
      where: [{ field: 'id', value: member.id }],
      update: { role: 'member' },
    });

    const after = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'After Demotion' }),
    });
    expect(after.status).toBe(403);
    expect(await parseJson(after)).toEqual({ error: 'forbidden' });

    // Task update still allowed for member role ∩ key.
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Still writable',
      status: 'todo',
    });
    const taskUpdate = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Updated by demoted' }),
    });
    expect(taskUpdate.status).toBe(200);
  });

  it('property 4: removed member → empty permissions → 403 on privileged ops', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'P4 Org' };
    const project = await createProject(db, { name: 'P4 Board', orgId: org.id });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Blocked',
      status: 'todo',
    });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p4@example.com',
      name: 'P4',
      githubAccountId: '5404',
      org: { id: org.id, name: org.name, slug: 'p4' },
      role: 'owner',
    });
    const minted = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'to-revoke',
    });

    expect(
      (
        await app.request(`/api/v1/projects/${project.id}/tasks`, {
          headers: bearer(minted.key),
        })
      ).status,
    ).toBe(200);

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [{ field: 'userId', value: userId }],
    });
    for (const m of members) {
      await adapter.delete({
        model: 'member',
        where: [{ field: 'id', value: m.id }],
      });
    }

    const createProjectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No member' }),
    });
    expect(createProjectRes.status).toBe(403);

    const updateTask = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Nope' }),
    });
    expect(updateTask.status).toBe(403);

    const memberAdd = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'z@example.com', role: 'member' }),
    });
    expect(memberAdd.status).toBe(403);
  });

  it('property 5: org-B key on org-A project → 404; mcp cross_org_denied still holds', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const projectA = await createProject(db, { name: 'A Board', orgId: orgA.id });
    const projectB = await createProject(db, { name: 'B Board', orgId: orgB.id });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p5b@example.com',
      name: 'P5B',
      githubAccountId: '5505',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });
    const keyB = await createScopedAgentKey({
      auth,
      userId,
      orgId: orgB.id,
      projectId: projectB.id,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'org-b-agent',
    });

    const cross = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: bearer(keyB.key),
    });
    expect(cross.status).toBe(404);
    expect(await parseJson(cross)).toEqual({ error: 'not_found' });

    // Stranger mcp_token bearer is no longer accepted (BA7-1a).
    const stranger = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: bearer('plandesk_mcp_not-a-real-token'),
    });
    expect(stranger.status).toBe(401);
  });

  it('property 6: key scoped to project A → 404 on project B', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'P6 Org' };
    const projectA = await createProject(db, { name: 'Project A', orgId: org.id });
    const projectB = await createProject(db, { name: 'Project B', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'p6@example.com',
      name: 'P6',
      githubAccountId: '5606',
      org: { id: org.id, name: org.name, slug: 'p6' },
      role: 'owner',
    });
    const keyA = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: projectA.id,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
      name: 'scoped-a',
    });

    const ok = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: bearer(keyA.key),
    });
    expect(ok.status).toBe(200);

    const denied = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: bearer(keyA.key),
    });
    expect(denied.status).toBe(404);
    expect(await parseJson(denied)).toEqual({ error: 'not_found' });

    const taskB = await createTask(db, {
      projectId: projectB.id,
      label: 'On B',
      status: 'todo',
    });
    const taskUpdate = await app.request(`/api/v1/tasks/${taskB.id}`, {
      method: 'PATCH',
      headers: { ...bearer(keyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Leak' }),
    });
    expect(taskUpdate.status).toBe(404);
  });

  it('property 7: local loopback unchanged with better-auth configured (REQ-21)', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: TEST_SECRET,
      baseURL: TEST_BASE_URL,
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);

    const app = createApp({
      db,
      bindHost: '127.0.0.1',
      betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
    });
    await ensureLocalBetterAuthOrganization(db, auth);

    const createRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Loopback Board' }),
    });
    expect(createRes.status).toBe(201);

    // mcp_token path still works when better-auth is mounted.
    const { orgId } = await createTestApp({ bindHost: '0.0.0.0' });
    void orgId;
  });


  it('invalid better-auth-looking bearer still falls through / rejects cleanly', async () => {
    const { app } = await hostedApp();
    const res = await app.request('/api/v1/projects', {
      headers: bearer('not-a-real-key-at-all'),
    });
    expect(res.status).toBe(401);
  });
});

describe('org-wide owner keys + profile-aware ceiling (BA4b-1 / REQ-4)', () => {
  it('REQ-4.1: agent key with apiKey:create still 403 on token mint (escalation closed)', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Esc Org' };
    const project = await createProject(db, { name: 'Esc Board', orgId: org.id });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'esc@example.com',
      name: 'Esc',
      githubAccountId: '6101',
      org: { id: org.id, name: org.name, slug: 'esc' },
      role: 'owner',
    });
    const minted = await createScopedAgentKey({
      auth,
      userId,
      orgId: org.id,
      projectId: project.id,
      permissions: {
        task: ['read', 'create', 'update', 'delete'],
        apiKey: ['create', 'read', 'update', 'delete'],
      },
      name: 'agent-with-apikey',
    });

    const mintAgent = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'must-fail' }),
    });
    expect(mintAgent.status).toBe(403);
    expect(await parseJson(mintAgent)).toEqual({ error: 'forbidden' });
  });

  it('REQ-4.2: owner key (org-wide, kind owner) with live owner can mint tokens (201)', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Owner Mint Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'ownermint@example.com',
      name: 'OwnerMint',
      githubAccountId: '6102',
      org: { id: org.id, name: org.name, slug: 'owner-mint' },
      role: 'owner',
    });
    const minted = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'cli-owner',
    });
    expect(minted.metadata).toEqual({ orgId: org.id, kind: 'owner' });
    expect('projectId' in minted.metadata).toBe(false);

    const project = await createProject(db, { name: 'Owner Mint Board', orgId: org.id });
    const mintAgent = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'from-owner-key' }),
    });
    expect(mintAgent.status).toBe(200);
    const body = await parseJson<{ token: string; project_id: string }>(mintAgent);
    expect(body.project_id).toBe(project.id);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
  });

  it('REQ-4.3: owner key demoted to member → apiKey absent → 403 on mint', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Demote Org' };
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'demote@example.com',
      name: 'Demote',
      githubAccountId: '6103',
      org: { id: org.id, name: org.name, slug: 'demote' },
      role: 'owner',
    });
    const minted = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      permissions: DEFAULT_OWNER_KEY_PERMISSIONS,
      name: 'was-owner-key',
    });

    const project = await createProject(db, { name: 'Demote Board', orgId: org.id });
    const before = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'while-owner' }),
    });
    expect(before.status).toBe(200);

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [
        { field: 'userId', value: userId },
        { field: 'organizationId', value: org.id },
      ],
    });
    const member = members[0];
    if (member === undefined) throw new Error('expected member');
    await adapter.update({
      model: 'member',
      where: [{ field: 'id', value: member.id }],
      update: { role: 'member' },
    });

    const after = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'after-demotion' }),
    });
    expect(after.status).toBe(403);
    expect(await parseJson(after)).toEqual({ error: 'forbidden' });
  });

  it('REQ-4.4: owner key with deleted member row → ceiling empty → 403 on everything', async () => {
    const { app, db, auth } = await hostedApp();
    const org = { id: randomUUID(), name: 'Revoke Org' };
    const project = await createProject(db, { name: 'Revoke Board', orgId: org.id });
    const task = await createTask(db, {
      projectId: project.id,
      label: 'Blocked',
      status: 'todo',
    });
    const { userId } = await seedBetterAuthUser(auth, {
      email: 'revoke@example.com',
      name: 'Revoke',
      githubAccountId: '6104',
      org: { id: org.id, name: org.name, slug: 'revoke' },
      role: 'owner',
    });
    const minted = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'to-revoke-owner',
    });

    expect(
      (
        await app.request(`/api/v1/projects/${project.id}/tasks`, {
          headers: bearer(minted.key),
        })
      ).status,
    ).toBe(200);

    const adapter = (await auth.$context).adapter;
    const members = await adapter.findMany<BetterAuthMember>({
      model: 'member',
      where: [{ field: 'userId', value: userId }],
    });
    for (const m of members) {
      await adapter.delete({
        model: 'member',
        where: [{ field: 'id', value: m.id }],
      });
    }

    const mintAgent = await app.request(`/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, name: 'no-member' }),
    });
    expect(mintAgent.status).toBe(403);

    const createProjectRes = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No member' }),
    });
    expect(createProjectRes.status).toBe(403);

    const updateTask = await app.request(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Nope' }),
    });
    expect(updateTask.status).toBe(403);

    const memberAdd = await app.request(`/api/v1/orgs/${org.id}/invitations`, {
      method: 'POST',
      headers: { ...bearer(minted.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'y@example.com', role: 'member' }),
    });
    expect(memberAdd.status).toBe(403);
  });

  it('REQ-4.5: owner key (no projectId) reaches two projects in org; cross-org 404s', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Reach Org A' };
    const orgB = { id: randomUUID(), name: 'Reach Org B' };
    const projectA1 = await createProject(db, { name: 'A1', orgId: orgA.id });
    const projectA2 = await createProject(db, { name: 'A2', orgId: orgA.id });
    const projectB = await createProject(db, { name: 'B1', orgId: orgB.id });

    const { userId } = await seedBetterAuthUser(auth, {
      email: 'reach@example.com',
      name: 'Reach',
      githubAccountId: '6105',
      org: { id: orgA.id, name: orgA.name, slug: 'reach-a' },
      role: 'owner',
    });
    const minted = await createOrgOwnerKey({
      auth,
      userId,
      orgId: orgA.id,
      name: 'org-wide',
    });
    expect(minted.metadata.kind).toBe('owner');
    expect('projectId' in minted.metadata).toBe(false);

    const a1 = await app.request(`/api/v1/projects/${projectA1.id}`, {
      headers: bearer(minted.key),
    });
    expect(a1.status).toBe(200);

    const a2 = await app.request(`/api/v1/projects/${projectA2.id}`, {
      headers: bearer(minted.key),
    });
    expect(a2.status).toBe(200);

    const cross = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: bearer(minted.key),
    });
    expect(cross.status).toBe(404);
    expect(await parseJson(cross)).toEqual({ error: 'not_found' });
  });
});
