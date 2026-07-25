import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDb,
  createDocument,
  createFolder,
  createGuestSubmission,
  createShare,
  createTaskWithDefaultGoal as createTask,
  getProject,
  migrate,
  PLANDESK_EXPORT_VERSION,
  type Db,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import {
  createScopedAgentKey,
  createWorkspaceScopedAgentKey,
  DEFAULT_AGENT_KEY_PERMISSIONS,
} from './agent-keys.js';
import { runWithAuthContext, type AuthContext } from './auth-context.js';
import {
  createBetterAuth,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from './better-auth.js';
import { createTeamForOrg } from './identity.js';
import { createApp } from './server.js';
import { createServices, type Services } from './services/index.js';
import { parseJson } from './test-helpers.js';
import {
  createGetTaskHandler,
  createListCommentsHandler,
  createListSubmissionsHandler,
} from './test-support/mcp-tool-handlers.js';

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

type Fixture = {
  app: Hono;
  auth: BetterAuthInstance;
  db: Db;
  services: Services;
  orgId: string;
  ownerUserId: string;
  workspaceA: string;
  workspaceB: string;
  projectA: Awaited<ReturnType<typeof createProject>>;
  projectB: Awaited<ReturnType<typeof createProject>>;
  workspaceAKey: string;
  projectAKey: string;
};

async function seedOwner(auth: BetterAuthInstance, orgId: string): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  await adapter.create({
    model: 'organization',
    data: { id: orgId, name: 'Audit 3 Org', slug: `audit-3-${orgId}`, createdAt: now },
    forceAllowId: true,
  });
  const user = await adapter.create<UserRow>({
    model: 'user',
    data: {
      name: 'Audit 3 Owner',
      email: `audit-3-${orgId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create({
    model: 'member',
    data: { organizationId: orgId, userId: user.id, role: 'owner', createdAt: now },
  });
  return user.id;
}

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
  const ownerUserId = await seedOwner(auth, orgId);
  const workspaceA = (await createTeamForOrg(auth, orgId, 'Workspace A')).id;
  const workspaceB = (await createTeamForOrg(auth, orgId, 'Workspace B')).id;
  const projectA = await createProject(db, {
    name: 'Project A',
    orgId,
    workspaceId: workspaceA,
  });
  const projectB = await createProject(db, {
    name: 'Project B secret',
    description: 'workspace B confidential metadata',
    orgId,
    workspaceId: workspaceB,
  });

  const workspaceKey = await createWorkspaceScopedAgentKey({
    auth,
    userId: ownerUserId,
    orgId,
    teamId: workspaceA,
    permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
    name: 'workspace-a-agent',
  });
  const projectKey = await createScopedAgentKey({
    auth,
    userId: ownerUserId,
    orgId,
    projectId: projectA.id,
    permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
    name: 'project-a-agent',
  });

  const services = createServices({ db, auth });
  const app = createApp({
    db,
    services,
    betterAuthInstance: auth,
    bindHost: '0.0.0.0',
  });
  return {
    app,
    auth,
    db,
    services,
    orgId,
    ownerUserId,
    workspaceA,
    workspaceB,
    projectA,
    projectB,
    workspaceAKey: workspaceKey.key,
    projectAKey: projectKey.key,
  };
}

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

function jsonHeaders(key: string): Record<string, string> {
  return { ...bearer(key), 'Content-Type': 'application/json' };
}

function workspaceKeyContext(f: Fixture): AuthContext {
  return {
    kind: 'apikey',
    orgId: f.orgId,
    userId: f.ownerUserId,
    profile: 'agent',
    role: 'owner',
    workspaceId: f.workspaceA,
    permission: DEFAULT_AGENT_KEY_PERMISSIONS,
  };
}

function toolPayload<T>(result: { content: Array<{ type: string; text: string }> }): T {
  return JSON.parse(result.content[0]?.text ?? '{}') as T;
}

async function join(app: Hono, token: string, name: string): Promise<string> {
  const response = await app.request(`/api/v1/share/${token}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(200);
  return (await parseJson<{ session_token: string }>(response)).session_token;
}

describe('workspace-tier adversarial audit round 3', () => {
  it('CONFIRMED REPRO — invite-only project shares must not be readable through the public markdown route', async () => {
    const f = await fixture();
    const document = await createDocument(f.db, {
      projectId: f.projectA.id,
      title: 'Invite-only plan',
      body: '<p>invite-only workspace secret</p>',
    });
    const invite = await createShare(f.db, {
      projectId: f.projectA.id,
      audienceName: 'Named client only',
      mode: 'invite',
      invitedEmails: ['allowed@example.com'],
      permissions: { read: true, submit: false },
      policy: { tasks: [], documentIds: [document.id], fields: {} },
    });

    const markdown = await f.app.request(`/api/v1/share/${invite.token}.md`);
    const body = await markdown.text();

    expect({ status: markdown.status, leaked: body.includes('invite-only workspace secret') }).toEqual({
      status: 404,
      leaked: false,
    });
  });

  it('share reads: project/workspace guest sessions cannot swap view or submission tokens', async () => {
    const f = await fixture();
    const projectShare = await createShare(f.db, {
      projectId: f.projectA.id,
      audienceName: 'Project A client',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const workspaceShare = await createShare(f.db, {
      workspaceId: f.workspaceB,
      audienceName: 'Workspace B client',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const projectGuest = await join(f.app, projectShare.token, 'Project guest');
    const workspaceGuest = await join(f.app, workspaceShare.token, 'Workspace guest');

    const attempts = await Promise.all([
      f.app.request(`/api/v1/share/${workspaceShare.token}/view`, {
        headers: bearer(projectGuest),
      }),
      f.app.request(`/api/v1/share/${projectShare.token}/view`, {
        headers: bearer(workspaceGuest),
      }),
      f.app.request(`/api/v1/share/${workspaceShare.token}/submissions`, {
        headers: bearer(projectGuest),
      }),
      f.app.request(`/api/v1/share/${projectShare.token}/submissions`, {
        headers: bearer(workspaceGuest),
      }),
      f.app.request(`/api/v1/share/${workspaceShare.token}.md`),
    ]);

    expect(attempts.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  });

  it('CONFIRMED REPRO — a project-scoped key must not enumerate sibling projects', async () => {
    const f = await fixture();
    const response = await f.app.request('/api/v1/projects', {
      headers: bearer(f.projectAKey),
    });
    const projects = await parseJson<Array<{ id: string; name: string; description: string | null }>>(
      response,
    );

    expect({
      status: response.status,
      ids: projects.map((project) => project.id),
      leakedMetadata: JSON.stringify(projects).includes('workspace B confidential metadata'),
    }).toEqual({ status: 200, ids: [f.projectA.id], leakedMetadata: false });
  });

  it('CONFIRMED REPRO — a project-scoped key must not publish an entire sibling workspace', async () => {
    const f = await fixture();
    await createTask(f.db, {
      projectId: f.projectB.id,
      label: 'workspace B portal secret',
      status: 'todo',
    });
    const create = await f.app.request(`/api/v1/workspaces/${f.workspaceB}/share`, {
      method: 'POST',
      headers: jsonHeaders(f.projectAKey),
      body: JSON.stringify({ audience_name: 'Escaped portal', mode: 'public' }),
    });
    const created = await parseJson<{ token?: string }>(create);
    let viewStatus = 404;
    let leaked = false;
    if (created.token !== undefined) {
      const guest = await join(f.app, created.token, 'Attacker guest');
      const view = await f.app.request(`/api/v1/share/${created.token}/view`, {
        headers: bearer(guest),
      });
      viewStatus = view.status;
      leaked = (await view.text()).includes('workspace B portal secret');
    }

    expect({ createStatus: create.status, viewStatus, leaked }).toEqual({
      createStatus: 404,
      viewStatus: 404,
      leaked: false,
    });
  });

  it('nested create routes reject a workspace-A key targeting project B', async () => {
    const f = await fixture();
    const taskB = await createTask(f.db, {
      projectId: f.projectB.id,
      label: 'B comment target',
      status: 'todo',
    });
    const requests = [
      ['/api/v1/projects/' + f.projectB.id + '/goals', { objective: 'escaped' }],
      ['/api/v1/projects/' + f.projectB.id + '/documents', { title: 'escaped' }],
      ['/api/v1/projects/' + f.projectB.id + '/notes', { title: 'escaped' }],
      ['/api/v1/projects/' + f.projectB.id + '/folders', { name: 'escaped' }],
      ['/api/v1/projects/' + f.projectB.id + '/tags', { name: 'escaped' }],
      ['/api/v1/projects/' + f.projectB.id + '/tasks', { label: 'escaped' }],
      [
        '/api/v1/projects/' + f.projectB.id + '/files',
        {
          filename: 'escaped.txt',
          mime: 'text/plain',
          content_base64: Buffer.from('escaped').toString('base64'),
        },
      ],
      ['/api/v1/tasks/' + taskB.id + '/comments', { body: 'escaped' }],
    ] as const;
    const responses = await Promise.all(
      requests.map(([path, body]) =>
        f.app.request(path, {
          method: 'POST',
          headers: jsonHeaders(f.workspaceAKey),
          body: JSON.stringify(body),
        }),
      ),
    );
    const canvas = await f.app.request(`/api/v1/projects/${f.projectB.id}/canvas`, {
      method: 'PUT',
      headers: jsonHeaders(f.workspaceAKey),
      body: JSON.stringify({ nodes: [], edges: [] }),
    });

    expect([...responses.map((response) => response.status), canvas.status]).toEqual([
      404, 404, 404, 404, 404, 404, 404, 404, 404,
    ]);
  });

  it('foreign document/task/folder/edge references are rejected before reassignment', async () => {
    const f = await fixture();
    const taskA = await createTask(f.db, { projectId: f.projectA.id, label: 'A task' });
    const taskB = await createTask(f.db, { projectId: f.projectB.id, label: 'B task' });
    const documentA = await createDocument(f.db, {
      projectId: f.projectA.id,
      title: 'A document',
    });
    const documentB = await createDocument(f.db, {
      projectId: f.projectB.id,
      title: 'B document',
    });
    const folderB = await createFolder(f.db, { projectId: f.projectB.id, name: 'B folder' });

    const foreignDocEdge = await f.app.request(`/api/v1/projects/${f.projectA.id}/edges`, {
      method: 'POST',
      headers: jsonHeaders(f.workspaceAKey),
      body: JSON.stringify({
        from_type: 'document',
        from_id: documentA.id,
        to_type: 'task',
        to_id: taskB.id,
        label: 'documents',
      }),
    });
    const parent = await f.app.request(`/api/v1/documents/${documentA.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(f.workspaceAKey),
      body: JSON.stringify({ parent_id: documentB.id }),
    });
    const folder = await f.app.request(`/api/v1/documents/${documentA.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(f.workspaceAKey),
      body: JSON.stringify({ folder_id: folderB.id }),
    });
    const edge = await f.app.request(`/api/v1/projects/${f.projectA.id}/canvas`, {
      method: 'PUT',
      headers: jsonHeaders(f.workspaceAKey),
      body: JSON.stringify({
        nodes: [],
        edges: [{ from_task_id: taskA.id, to_task_id: taskB.id }],
      }),
    });

    expect([foreignDocEdge.status, parent.status, folder.status, edge.status]).toEqual([
      400, 400, 400, 400,
    ]);
  });

  it('CONFIRMED REPRO — custom organization:update on an agent key must not import outside its workspace', async () => {
    const f = await fixture();
    const custom = await createWorkspaceScopedAgentKey({
      auth: f.auth,
      userId: f.ownerUserId,
      orgId: f.orgId,
      teamId: f.workspaceA,
      permissions: {
        member: ['create'],
        organization: ['update'],
        invitation: ['create'],
        apiKey: ['create'],
        team: ['create'],
      },
      name: 'custom-escalation-probe',
    });
    const portable = {
      version: PLANDESK_EXPORT_VERSION,
      project: {
        name: 'Escaped imported project',
        description: null,
        canvas_layout: null,
      },
      tasks: [],
      edges: [],
      documents: [],
      agent_runs: [],
    };
    const response = await f.app.request(`/api/v1/orgs/${f.orgId}/import`, {
      method: 'POST',
      headers: jsonHeaders(custom.key),
      body: JSON.stringify(portable),
    });
    const body = await parseJson<{ globalProjectId?: string }>(response);
    const imported =
      body.globalProjectId === undefined ? undefined : await getProject(f.db, body.globalProjectId);

    expect({
      status: response.status,
      created: imported !== undefined,
      escapedWorkspace: imported !== undefined && imported.workspaceId !== f.workspaceA,
    }).toEqual({ status: 403, created: false, escapedWorkspace: false });
  });

  it('org/member/invitation/api-key plugin surfaces reject an agent bearer', async () => {
    const f = await fixture();
    const requests = [
      ['/api/auth/organization/update', { organizationId: f.orgId, data: { name: 'Pwned' } }],
      ['/api/auth/organization/delete', { organizationId: f.orgId }],
      [
        '/api/auth/organization/remove-member',
        { organizationId: f.orgId, memberIdOrEmail: f.ownerUserId },
      ],
      [
        '/api/auth/organization/update-member-role',
        { organizationId: f.orgId, memberId: f.ownerUserId, role: 'member' },
      ],
      [
        '/api/auth/organization/invite-member',
        { organizationId: f.orgId, email: 'outsider@example.com', role: 'member' },
      ],
      ['/api/auth/organization/cancel-invitation', { invitationId: randomUUID() }],
      ['/api/auth/api-key/create', { name: 'escaped-key' }],
    ] as const;
    const responses = await Promise.all(
      requests.map(([path, body]) =>
        f.app.request(path, {
          method: 'POST',
          headers: jsonHeaders(f.workspaceAKey),
          body: JSON.stringify(body),
        }),
      ),
    );
    const listKeys = await f.app.request('/api/auth/api-key/list', {
      headers: bearer(f.workspaceAKey),
    });

    expect([...responses.map((response) => response.status), listKeys.status].every((status) => status === 401 || status === 403)).toBe(true);
  });

  it('CONFIRMED REPRO — MCP get_task must not return sibling-workspace or cross-org task data', async () => {
    const f = await fixture();
    const taskB = await createTask(f.db, {
      projectId: f.projectB.id,
      label: 'workspace B MCP secret',
    });
    const otherOrgProject = await createProject(f.db, {
      name: 'Other org project',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const otherOrgTask = await createTask(f.db, {
      projectId: otherOrgProject.id,
      label: 'cross-org MCP secret',
    });
    const handler = createGetTaskHandler(f.services.taskService);

    const [workspaceResult, crossOrgResult] = await runWithAuthContext(
      workspaceKeyContext(f),
      () => Promise.all([handler({ task_id: taskB.id }), handler({ task_id: otherOrgTask.id })]),
    );

    expect({
      workspaceError: workspaceResult.isError === true,
      crossOrgError: crossOrgResult.isError === true,
      leaked:
        JSON.stringify(toolPayload(workspaceResult)).includes('workspace B MCP secret') ||
        JSON.stringify(toolPayload(crossOrgResult)).includes('cross-org MCP secret'),
    }).toEqual({ workspaceError: true, crossOrgError: true, leaked: false });
  });

  it('CONFIRMED REPRO — MCP list_submissions must not return sibling-workspace or cross-org rows', async () => {
    const f = await fixture();
    const shareB = await createShare(f.db, {
      projectId: f.projectB.id,
      audienceName: 'B inbox',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    await createGuestSubmission(f.db, {
      projectId: f.projectB.id,
      hostedShareId: shareB.share.id,
      participantName: 'B client',
      title: 'workspace B submission secret',
    });
    const otherOrgProject = await createProject(f.db, {
      name: 'Other org inbox',
      orgId: randomUUID(),
      workspaceId: randomUUID(),
    });
    const otherShare = await createShare(f.db, {
      projectId: otherOrgProject.id,
      audienceName: 'Other org inbox',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    await createGuestSubmission(f.db, {
      projectId: otherOrgProject.id,
      hostedShareId: otherShare.share.id,
      participantName: 'Other client',
      title: 'cross-org submission secret',
    });
    // This is the exact callback wired in createMcpServer. The missing await
    // makes every Promise compare unequal to undefined.
    const handler = createListSubmissionsHandler(
      f.services.syncService,
      (projectId: string) => f.services.projectService.get(projectId) !== undefined,
    );

    const [workspaceResult, crossOrgResult] = await runWithAuthContext(
      workspaceKeyContext(f),
      () =>
        Promise.all([
          handler({ project_id: f.projectB.id }),
          handler({ project_id: otherOrgProject.id }),
        ]),
    );

    expect({
      workspaceError: workspaceResult.isError === true,
      crossOrgError: crossOrgResult.isError === true,
      leaked:
        JSON.stringify(toolPayload(workspaceResult)).includes('workspace B submission secret') ||
        JSON.stringify(toolPayload(crossOrgResult)).includes('cross-org submission secret'),
    }).toEqual({ workspaceError: true, crossOrgError: true, leaked: false });
  });

  it('CONFIRMED REPRO — MCP list_comments must not reveal a foreign target via invalid_argument', async () => {
    const f = await fixture();
    const taskB = await createTask(f.db, { projectId: f.projectB.id, label: 'foreign target' });
    const handler = createListCommentsHandler(f.services.commentService);

    const result = await runWithAuthContext(workspaceKeyContext(f), () =>
      handler({
        project_id: f.projectA.id,
        target_type: 'task',
        target_id: taskB.id,
      }),
    );

    expect(toolPayload(result)).toEqual({ error: 'not_found' });
  });
});
