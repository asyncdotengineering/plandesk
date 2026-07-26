import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createAgentRun,
  createArtifact,
  createComment,
  createDb,
  createDocument,
  createEdge,
  createFolder,
  createGoal,
  createNote,
  createTaskWithDefaultGoal as createTask,
  migrate,
  type Db,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import {
  createOrgOwnerKey,
  createWorkspaceScopedAgentKey,
  DEFAULT_AGENT_KEY_PERMISSIONS,
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

describe('resource tenant isolation (cross-org + cross-workspace)', () => {
  it('documents: org-B and workspace-B keys cannot access org-A/workspace-A document', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    await createProject(db, { name: 'Project B', orgId: orgA.id, workspaceId: wsB });
    await createProject(db, { name: 'Project Other', orgId: orgB.id, workspaceId: wsA });

    const taskA = await createTask(db, { projectId: projectA.id, label: 'Task A', status: 'todo' });
    const doc = await createDocument(db, { projectId: projectA.id, title: 'Doc A' });
    await createEdge(db, {
      projectId: projectA.id,
      fromType: 'document',
      fromId: doc.id,
      toType: 'task',
      toId: taskA.id,
      label: 'documents',
    });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8001',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });

    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8002',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    const wsKeyA = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // GET cross-org → 404
    const getCrossOrg = await app.request(`/api/v1/documents/${doc.id}`, { headers: bearer(ownerKeyB.key) });
    expect(getCrossOrg.status).toBe(404);
    expect(await parseJson(getCrossOrg)).toEqual({ error: 'not_found' });

    // GET cross-workspace → 404
    const getCrossWs = await app.request(`/api/v1/documents/${doc.id}`, { headers: bearer(wsKeyB.key) });
    expect(getCrossWs.status).toBe(404);
    expect(await parseJson(getCrossWs)).toEqual({ error: 'not_found' });

    // GET in-scope → 200
    const getOk = await app.request(`/api/v1/documents/${doc.id}`, { headers: bearer(ownerKeyA.key) });
    expect(getOk.status).toBe(200);
    const getWsOk = await app.request(`/api/v1/documents/${doc.id}`, { headers: bearer(wsKeyA.key) });
    expect(getWsOk.status).toBe(200);

    // PATCH cross-org → 404
    const patchCrossOrg = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Leaked' }),
    });
    expect(patchCrossOrg.status).toBe(404);
    expect(await parseJson(patchCrossOrg)).toEqual({ error: 'not_found' });

    // PATCH cross-workspace → 404
    const patchCrossWs = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Leaked' }),
    });
    expect(patchCrossWs.status).toBe(404);

    // PATCH in-scope → 200
    const patchOk = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(patchOk.status).toBe(200);

    // DELETE cross-org → 404
    const delCrossOrg = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'DELETE',
      headers: bearer(ownerKeyB.key),
    });
    expect(delCrossOrg.status).toBe(404);
    expect(await parseJson(delCrossOrg)).toEqual({ error: 'not_found' });

    // DELETE cross-workspace → 404
    const delCrossWs = await app.request(`/api/v1/documents/${doc.id}`, {
      method: 'DELETE',
      headers: bearer(wsKeyB.key),
    });
    expect(delCrossWs.status).toBe(404);

    // DELETE in-scope → 204 (but we won't delete because we need doc for getByTask)
    // Instead test getByTask cross-org / cross-workspace
    const taskDocCrossOrg = await app.request(`/api/v1/tasks/${taskA.id}/document`, { headers: bearer(ownerKeyB.key) });
    expect(taskDocCrossOrg.status).toBe(404);
    const taskDocCrossWs = await app.request(`/api/v1/tasks/${taskA.id}/document`, { headers: bearer(wsKeyB.key) });
    expect(taskDocCrossWs.status).toBe(404);
    const taskDocOk = await app.request(`/api/v1/tasks/${taskA.id}/document`, { headers: bearer(ownerKeyA.key) });
    expect(taskDocOk.status).toBe(200);
  });

  it('goals: org-B and workspace-B keys cannot access org-A/workspace-A goal', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    await createProject(db, { name: 'Project B', orgId: orgA.id, workspaceId: wsB });
    await createProject(db, { name: 'Project Other', orgId: orgB.id, workspaceId: wsA });

    const goalActive = await createGoal(db, { projectId: projectA.id, objective: 'Active', status: 'active' });
    const goalPaused = await createGoal(db, { projectId: projectA.id, objective: 'Paused', status: 'paused' });
    const goalBlocked = await createGoal(db, { projectId: projectA.id, objective: 'Blocked', status: 'blocked' });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8003',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });

    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8004',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // GET cross-org
    const getCrossOrg = await app.request(`/api/v1/goals/${goalActive.id}`, { headers: bearer(ownerKeyB.key) });
    expect(getCrossOrg.status).toBe(404);
    // GET cross-workspace
    const getCrossWs = await app.request(`/api/v1/goals/${goalActive.id}`, { headers: bearer(wsKeyB.key) });
    expect(getCrossWs.status).toBe(404);
    // GET in-scope
    expect((await app.request(`/api/v1/goals/${goalActive.id}`, { headers: bearer(ownerKeyA.key) })).status).toBe(200);

    // PATCH cross-org
    const patchCrossOrg = await app.request(`/api/v1/goals/${goalActive.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'Leaked' }),
    });
    expect(patchCrossOrg.status).toBe(404);
    // PATCH cross-workspace
    const patchCrossWs = await app.request(`/api/v1/goals/${goalActive.id}`, {
      method: 'PATCH',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'Leaked' }),
    });
    expect(patchCrossWs.status).toBe(404);
    // PATCH in-scope
    const patchOk = await app.request(`/api/v1/goals/${goalActive.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'Updated' }),
    });
    expect(patchOk.status).toBe(200);

    // POST /pause cross-org
    const pauseCrossOrg = await app.request(`/api/v1/goals/${goalActive.id}/pause`, {
      method: 'POST',
      headers: bearer(ownerKeyB.key),
    });
    expect(pauseCrossOrg.status).toBe(404);
    // POST /pause cross-workspace
    const pauseCrossWs = await app.request(`/api/v1/goals/${goalActive.id}/pause`, {
      method: 'POST',
      headers: bearer(wsKeyB.key),
    });
    expect(pauseCrossWs.status).toBe(404);
    // POST /pause in-scope
    const pauseOk = await app.request(`/api/v1/goals/${goalActive.id}/pause`, {
      method: 'POST',
      headers: bearer(ownerKeyA.key),
    });
    expect(pauseOk.status).toBe(200);

    // POST /resume cross-org
    const resumeCrossOrg = await app.request(`/api/v1/goals/${goalPaused.id}/resume`, {
      method: 'POST',
      headers: bearer(ownerKeyB.key),
    });
    expect(resumeCrossOrg.status).toBe(404);
    // POST /resume cross-workspace
    const resumeCrossWs = await app.request(`/api/v1/goals/${goalPaused.id}/resume`, {
      method: 'POST',
      headers: bearer(wsKeyB.key),
    });
    expect(resumeCrossWs.status).toBe(404);
    // POST /resume in-scope
    const resumeOk = await app.request(`/api/v1/goals/${goalPaused.id}/resume`, {
      method: 'POST',
      headers: bearer(ownerKeyA.key),
    });
    expect(resumeOk.status).toBe(200);

    // POST /complete cross-org
    const completeCrossOrg = await app.request(`/api/v1/goals/${goalBlocked.id}/complete`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(completeCrossOrg.status).toBe(404);
    // POST /complete cross-workspace
    const completeCrossWs = await app.request(`/api/v1/goals/${goalBlocked.id}/complete`, {
      method: 'POST',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(completeCrossWs.status).toBe(404);
    // POST /complete in-scope
    const completeOk = await app.request(`/api/v1/goals/${goalBlocked.id}/complete`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(completeOk.status).toBe(200);
  });

  it('notes: org-B and workspace-B keys cannot access org-A/workspace-A note', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    const note = await createNote(db, { projectId: projectA.id, title: 'Note A' });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8005',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8006',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    const wsKeyA = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // GET cross-org / cross-workspace
    expect((await app.request(`/api/v1/notes/${note.id}`, { headers: bearer(ownerKeyB.key) })).status).toBe(404);
    expect((await app.request(`/api/v1/notes/${note.id}`, { headers: bearer(wsKeyB.key) })).status).toBe(404);
    expect((await app.request(`/api/v1/notes/${note.id}`, { headers: bearer(ownerKeyA.key) })).status).toBe(200);
    expect((await app.request(`/api/v1/notes/${note.id}`, { headers: bearer(wsKeyA.key) })).status).toBe(200);

    // PATCH cross-org / cross-workspace
    const patchCrossOrg = await app.request(`/api/v1/notes/${note.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Leaked' }),
    });
    expect(patchCrossOrg.status).toBe(404);
    const patchCrossWs = await app.request(`/api/v1/notes/${note.id}`, {
      method: 'PATCH',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Leaked' }),
    });
    expect(patchCrossWs.status).toBe(404);
    const patchOk = await app.request(`/api/v1/notes/${note.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(patchOk.status).toBe(200);

    // DELETE cross-org / cross-workspace
    const delCrossOrg = await app.request(`/api/v1/notes/${note.id}`, { method: 'DELETE', headers: bearer(ownerKeyB.key) });
    expect(delCrossOrg.status).toBe(404);
    const delCrossWs = await app.request(`/api/v1/notes/${note.id}`, { method: 'DELETE', headers: bearer(wsKeyB.key) });
    expect(delCrossWs.status).toBe(404);
    // Don't delete the in-scope one so we can verify it still exists
    const delOk = await app.request(`/api/v1/notes/${note.id}`, { method: 'DELETE', headers: bearer(ownerKeyA.key) });
    expect(delOk.status).toBe(204);
  });

  it('folders: org-B and workspace-B keys cannot access org-A/workspace-A folder', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    const folder = await createFolder(db, { projectId: projectA.id, name: 'Folder A' });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8007',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8008',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    const wsKeyA = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // GET
    expect((await app.request(`/api/v1/folders/${folder.id}`, { headers: bearer(ownerKeyB.key) })).status).toBe(404);
    expect((await app.request(`/api/v1/folders/${folder.id}`, { headers: bearer(wsKeyB.key) })).status).toBe(404);
    expect((await app.request(`/api/v1/folders/${folder.id}`, { headers: bearer(ownerKeyA.key) })).status).toBe(200);
    expect((await app.request(`/api/v1/folders/${folder.id}`, { headers: bearer(wsKeyA.key) })).status).toBe(200);

    // PATCH
    const patchCrossOrg = await app.request(`/api/v1/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leaked' }),
    });
    expect(patchCrossOrg.status).toBe(404);
    const patchCrossWs = await app.request(`/api/v1/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leaked' }),
    });
    expect(patchCrossWs.status).toBe(404);
    const patchOk = await app.request(`/api/v1/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(patchOk.status).toBe(200);

    // DELETE
    const delCrossOrg = await app.request(`/api/v1/folders/${folder.id}`, { method: 'DELETE', headers: bearer(ownerKeyB.key) });
    expect(delCrossOrg.status).toBe(404);
    const delCrossWs = await app.request(`/api/v1/folders/${folder.id}`, { method: 'DELETE', headers: bearer(wsKeyB.key) });
    expect(delCrossWs.status).toBe(404);
    const delOk = await app.request(`/api/v1/folders/${folder.id}`, { method: 'DELETE', headers: bearer(ownerKeyA.key) });
    expect(delOk.status).toBe(204);
  });

  it('artifacts: org-B and workspace-B keys cannot access org-A/workspace-A artifact', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    const artifact = await createArtifact(db, { projectId: projectA.id, title: 'Artifact A', kind: 'markdown' });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8009',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8010',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    const wsKeyA = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // GET
    expect((await app.request(`/api/v1/artifacts/${artifact.id}`, { headers: bearer(ownerKeyB.key) })).status).toBe(404);
    expect((await app.request(`/api/v1/artifacts/${artifact.id}`, { headers: bearer(wsKeyB.key) })).status).toBe(404);
    expect((await app.request(`/api/v1/artifacts/${artifact.id}`, { headers: bearer(ownerKeyA.key) })).status).toBe(200);
    expect((await app.request(`/api/v1/artifacts/${artifact.id}`, { headers: bearer(wsKeyA.key) })).status).toBe(200);

    // PATCH
    const patchCrossOrg = await app.request(`/api/v1/artifacts/${artifact.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Leaked' }),
    });
    expect(patchCrossOrg.status).toBe(404);
    const patchCrossWs = await app.request(`/api/v1/artifacts/${artifact.id}`, {
      method: 'PATCH',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Leaked' }),
    });
    expect(patchCrossWs.status).toBe(404);
    const patchOk = await app.request(`/api/v1/artifacts/${artifact.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(patchOk.status).toBe(200);
  });

  it('comments: org-B and workspace-B keys cannot update/delete org-A/workspace-A comment', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    const doc = await createDocument(db, { projectId: projectA.id, title: 'Doc A' });
    const comment = await createComment(db, { projectId: projectA.id, targetType: 'document', targetId: doc.id, body: 'Nice' });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8011',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8012',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // PATCH cross-org / cross-workspace
    const patchCrossOrg = await app.request(`/api/v1/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Leaked' }),
    });
    expect(patchCrossOrg.status).toBe(404);
    const patchCrossWs = await app.request(`/api/v1/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Leaked' }),
    });
    expect(patchCrossWs.status).toBe(404);
    const patchOk = await app.request(`/api/v1/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Updated' }),
    });
    expect(patchOk.status).toBe(200);

    // DELETE cross-org / cross-workspace
    const delCrossOrg = await app.request(`/api/v1/comments/${comment.id}`, { method: 'DELETE', headers: bearer(ownerKeyB.key) });
    expect(delCrossOrg.status).toBe(404);
    const delCrossWs = await app.request(`/api/v1/comments/${comment.id}`, { method: 'DELETE', headers: bearer(wsKeyB.key) });
    expect(delCrossWs.status).toBe(404);
    const delOk = await app.request(`/api/v1/comments/${comment.id}`, { method: 'DELETE', headers: bearer(ownerKeyA.key) });
    expect(delOk.status).toBe(204);
  });

  it('agent-runs: org-B and workspace-B keys cannot record progress on org-A/workspace-A run', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });
    const run = await createAgentRun(db, { projectId: projectA.id, label: 'Run A' });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8013',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8014',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    const wsKeyA = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // POST /progress cross-org
    const progCrossOrg = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Leaked' }),
    });
    expect(progCrossOrg.status).toBe(404);
    expect(await parseJson(progCrossOrg)).toEqual({ error: 'not_found' });

    // POST /progress cross-workspace
    const progCrossWs = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { ...bearer(wsKeyB.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Leaked' }),
    });
    expect(progCrossWs.status).toBe(404);
    expect(await parseJson(progCrossWs)).toEqual({ error: 'not_found' });

    // POST /progress in-scope
    const progOk = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'OK' }),
    });
    expect(progOk.status).toBe(201);
    const progWsOk = await app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: { ...bearer(wsKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'OK2' }),
    });
    expect(progWsOk.status).toBe(201);
  });

  it('files: org-B and workspace-B keys cannot GET org-A/workspace-A file', async () => {
    const { app, db, auth } = await hostedApp();
    const orgA = { id: randomUUID(), name: 'Org A' };
    const orgB = { id: randomUUID(), name: 'Org B' };
    const wsA = randomUUID();
    const wsB = randomUUID();

    const projectA = await createProject(db, { name: 'Project A', orgId: orgA.id, workspaceId: wsA });

    const { userId: userA } = await seedBetterAuthUser(auth, {
      email: 'a@example.com',
      name: 'Owner A',
      githubAccountId: '8015',
      org: { id: orgA.id, name: orgA.name, slug: 'org-a' },
      role: 'owner',
    });
    const { userId: userB } = await seedBetterAuthUser(auth, {
      email: 'b@example.com',
      name: 'Owner B',
      githubAccountId: '8016',
      org: { id: orgB.id, name: orgB.name, slug: 'org-b' },
      role: 'owner',
    });

    const ownerKeyA = await createOrgOwnerKey({ auth, userId: userA, orgId: orgA.id, name: 'owner-a' });
    const wsKeyA = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsA,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-a',
    });
    const wsKeyB = await createWorkspaceScopedAgentKey({
      auth, userId: userA, orgId: orgA.id, teamId: wsB,
      permissions: DEFAULT_AGENT_KEY_PERMISSIONS, name: 'ws-b',
    });
    const ownerKeyB = await createOrgOwnerKey({ auth, userId: userB, orgId: orgB.id, name: 'owner-b' });

    // Upload file with ownerKeyA
    const bytes = Buffer.from('secret-payload', 'utf8');
    const uploadRes = await app.request(`/api/v1/projects/${projectA.id}/files`, {
      method: 'POST',
      headers: { ...bearer(ownerKeyA.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'secret.txt', mime: 'text/plain', content_base64: bytes.toString('base64') }),
    });
    expect(uploadRes.status).toBe(201);
    const file = await parseJson<{ id: string; url: string }>(uploadRes);

    // GET cross-org
    const getCrossOrg = await app.request(file.url, { headers: bearer(ownerKeyB.key) });
    expect(getCrossOrg.status).toBe(404);
    expect(await parseJson(getCrossOrg)).toEqual({ error: 'not_found' });

    // GET cross-workspace
    const getCrossWs = await app.request(file.url, { headers: bearer(wsKeyB.key) });
    expect(getCrossWs.status).toBe(404);
    expect(await parseJson(getCrossWs)).toEqual({ error: 'not_found' });

    // GET in-scope
    const getOk = await app.request(file.url, { headers: bearer(ownerKeyA.key) });
    expect(getOk.status).toBe(200);
    const getWsOk = await app.request(file.url, { headers: bearer(wsKeyA.key) });
    expect(getWsOk.status).toBe(200);
  });
});
