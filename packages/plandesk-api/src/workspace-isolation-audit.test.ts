import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createComment,
  createDb,
  createDocument,
  createEdge,
  createGuestSubmission,
  createShare,
  createTag,
  createTaskWithDefaultGoal as createTask,
  getEdge,
  getSubmission,
  getTag,
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
import { createTeamForOrg } from './identity.js';
import { createApp } from './server.js';
import { parseJson } from './test-helpers.js';

const TEST_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const TEST_BASE_URL = 'http://localhost:3000';

type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function seedOwner(
  auth: BetterAuthInstance,
  input: { orgId: string; orgName: string; email: string },
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  await adapter.create({
    model: 'organization',
    data: {
      id: input.orgId,
      name: input.orgName,
      slug: `org-${input.orgId}`,
      createdAt: now,
    },
    forceAllowId: true,
  });
  const user = await adapter.create<UserRow>({
    model: 'user',
    data: {
      name: input.orgName,
      email: input.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create({
    model: 'member',
    data: {
      organizationId: input.orgId,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    },
  });
  return user.id;
}

type Fixture = {
  app: Hono;
  auth: BetterAuthInstance;
  db: Db;
  orgId: string;
  workspaceA: string;
  workspaceB: string;
  projectA: Awaited<ReturnType<typeof createProject>>;
  projectB: Awaited<ReturnType<typeof createProject>>;
  workspaceAKey: string;
  userId: string;
};

async function fixture(): Promise<Fixture> {
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
  const userId = await seedOwner(auth, {
    orgId,
    orgName: 'Audit Org',
    email: `owner-${orgId}@example.com`,
  });
  const workspaceA = (await createTeamForOrg(auth, orgId, 'Workspace A')).id;
  const workspaceB = (await createTeamForOrg(auth, orgId, 'Workspace B')).id;
  const projectA = await createProject(db, {
    name: 'Project A',
    orgId,
    workspaceId: workspaceA,
  });
  const projectB = await createProject(db, {
    name: 'Project B secret',
    orgId,
    workspaceId: workspaceB,
  });
  const key = await createWorkspaceScopedAgentKey({
    auth,
    userId,
    orgId,
    teamId: workspaceA,
    permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
    name: 'workspace-a-agent',
  });
  const app = createApp({
    db,
    bindHost: '0.0.0.0',
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
  });
  return {
    app,
    auth,
    db,
    orgId,
    workspaceA,
    workspaceB,
    projectA,
    projectB,
    workspaceAKey: key.key,
    userId,
  };
}

function bearer(key: string): { Authorization: string } {
  return { Authorization: `Bearer ${key}` };
}

describe('workspace-tier adversarial audit repros', () => {
  it('comments: a workspace-A key cannot list comments on a workspace-B document', async () => {
    const f = await fixture();
    const document = await createDocument(f.db, {
      projectId: f.projectB.id,
      title: 'Workspace B private document',
    });
    await createComment(f.db, {
      projectId: f.projectB.id,
      targetType: 'document',
      targetId: document.id,
      body: 'workspace B secret comment',
    });

    const response = await f.app.request(`/api/v1/documents/${document.id}/comments`, {
      headers: bearer(f.workspaceAKey),
    });
    const body = await parseJson<unknown[]>(response);

    expect({ status: response.status, leakedRows: body.length }).toEqual({
      status: 404,
      leakedRows: 0,
    });
  });

  it('artifact comments: a workspace-A key cannot create a comment in workspace B', async () => {
    const f = await fixture();
    const response = await f.app.request(`/api/v1/projects/${f.projectB.id}/artifact-comments`, {
      method: 'POST',
      headers: { ...bearer(f.workspaceAKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: 'private/path.md', body: 'cross-workspace write' }),
    });

    expect(response.status).toBe(404);
  });

  it('tags: a workspace-A key cannot rename a workspace-B tag', async () => {
    const f = await fixture();
    const tag = await createTag(f.db, { projectId: f.projectB.id, name: 'private-tag' });
    const response = await f.app.request(`/api/v1/tags/${tag.id}`, {
      method: 'PATCH',
      headers: { ...bearer(f.workspaceAKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pwned' }),
    });

    expect({ status: response.status, persistedName: (await getTag(f.db, tag.id))?.name }).toEqual({
      status: 404,
      persistedName: 'private-tag',
    });
  });

  it('canvas: a workspace-A key cannot delete a workspace-B edge', async () => {
    const f = await fixture();
    const from = await createTask(f.db, {
      projectId: f.projectB.id,
      label: 'from',
      status: 'todo',
    });
    const to = await createTask(f.db, { projectId: f.projectB.id, label: 'to', status: 'todo' });
    const edge = await createEdge(f.db, {
      projectId: f.projectB.id,
      fromTaskId: from.id,
      toTaskId: to.id,
    });
    const response = await f.app.request(`/api/v1/projects/${f.projectB.id}/edges/${edge.id}`, {
      method: 'DELETE',
      headers: bearer(f.workspaceAKey),
    });

    expect({
      status: response.status,
      stillExists: (await getEdge(f.db, edge.id)) !== undefined,
    }).toEqual({
      status: 404,
      stillExists: true,
    });
  });

  it('claim: a workspace-A key cannot claim a workspace-B task', async () => {
    const f = await fixture();
    const task = await createTask(f.db, {
      projectId: f.projectB.id,
      label: 'Workspace B private task',
      status: 'todo',
    });
    const response = await f.app.request(`/api/v1/tasks/${task.id}/claim`, {
      method: 'POST',
      headers: { ...bearer(f.workspaceAKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_ref: 'workspace-a-attacker' }),
    });

    expect(response.status).toBe(404);
  });

  it('project creation: a workspace-A key cannot create a project in workspace B', async () => {
    const f = await fixture();
    const response = await f.app.request('/api/v1/projects', {
      method: 'POST',
      headers: { ...bearer(f.workspaceAKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Escaped project', workspace_id: f.workspaceB }),
    });

    expect(response.status).toBe(404);
  });

  it('resource sharing: an org-B owner key cannot publish an org-A document', async () => {
    const f = await fixture();
    const document = await createDocument(f.db, {
      projectId: f.projectB.id,
      title: 'Org A private document',
      body: '<p>cross-org secret</p>',
    });
    const orgB = randomUUID();
    const orgBUser = await seedOwner(f.auth, {
      orgId: orgB,
      orgName: 'Attacker Org B',
      email: `owner-${orgB}@example.com`,
    });
    const orgBKey = await createOrgOwnerKey({
      auth: f.auth,
      userId: orgBUser,
      orgId: orgB,
      name: 'org-b-owner',
    });

    const response = await f.app.request(`/api/v1/documents/${document.id}/share`, {
      method: 'POST',
      headers: { ...bearer(orgBKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires: '24h' }),
    });
    const created = await parseJson<{ markdown_url?: string }>(response);
    const markdownResponse = await f.app.request(created.markdown_url ?? '/missing');
    const markdown = await markdownResponse.text();

    expect({
      createStatus: response.status,
      markdownStatus: markdownResponse.status,
      leakedSecret: markdown.includes('cross-org secret'),
    }).toEqual({ createStatus: 404, markdownStatus: 404, leakedSecret: false });
  });

  it('workspace sharing: a workspace-A key cannot create a portal for workspace B', async () => {
    const f = await fixture();
    const response = await f.app.request(`/api/v1/workspaces/${f.workspaceB}/share`, {
      method: 'POST',
      headers: { ...bearer(f.workspaceAKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience_name: 'Unauthorized client', mode: 'public' }),
    });

    expect(response.status).toBe(404);
  });

  it('enumeration: a workspace-A key cannot list sibling workspaces or org member PII', async () => {
    const f = await fixture();
    const workspacesResponse = await f.app.request(`/api/v1/orgs/${f.orgId}/workspaces`, {
      headers: bearer(f.workspaceAKey),
    });
    const workspaces = await parseJson<{ workspaces: Array<{ id: string }> }>(workspacesResponse);
    const membersResponse = await f.app.request(`/api/v1/orgs/${f.orgId}/members`, {
      headers: bearer(f.workspaceAKey),
    });

    expect({
      workspaceIds: workspaces.workspaces.map((workspace) => workspace.id),
      membersStatus: membersResponse.status,
    }).toEqual({ workspaceIds: [f.workspaceA], membersStatus: 403 });
  });

  it('privilege escalation: custom permissions cannot let a scoped agent create workspaces', async () => {
    const f = await fixture();
    const customKey = await createWorkspaceScopedAgentKey({
      auth: f.auth,
      userId: f.userId,
      orgId: f.orgId,
      teamId: f.workspaceA,
      permissions: { team: ['create'] },
      name: 'scoped-team-creator',
    });
    const response = await f.app.request(`/api/v1/orgs/${f.orgId}/workspaces`, {
      method: 'POST',
      headers: { ...bearer(customKey.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Escaped workspace' }),
    });

    expect(response.status).toBe(403);
  });

  it('submissions: a workspace-A key cannot reject a workspace-B submission by id', async () => {
    const f = await fixture();
    const { share } = await createShare(f.db, {
      projectId: f.projectB.id,
      audienceName: 'Workspace B client',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const submission = await createGuestSubmission(f.db, {
      projectId: f.projectB.id,
      hostedShareId: share.id,
      participantName: 'Client',
      title: 'Workspace B private submission',
    });
    const response = await f.app.request(`/api/v1/submissions/${submission.id}/triage`, {
      method: 'POST',
      headers: { ...bearer(f.workspaceAKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject' }),
    });

    expect({
      status: response.status,
      persistedStatus: (await getSubmission(f.db, submission.id))?.status,
    }).toEqual({ status: 404, persistedStatus: 'pending' });
  });
});
