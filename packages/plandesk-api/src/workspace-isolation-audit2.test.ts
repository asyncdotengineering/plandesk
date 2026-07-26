import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentRun,
  createComment,
  createDb,
  createDocument,
  createFolder,
  createGoal,
  createGuestSubmission,
  createNote,
  createShare,
  createTaskWithDefaultGoal as createTask,
  getComment,
  getDocument,
  getFolder,
  getGoal,
  getProject,
  getSubmission,
  migrate,
  setSyncRemote,
  type Db,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject } from '@plandesk/db/testing';
import type { Hono } from 'hono';
import {
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
import { mintSessionCookieHeader } from './invitations.js';
import { createApp } from './server.js';
import { createServices, type Services } from './services/index.js';
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

async function seedUser(
  auth: BetterAuthInstance,
  input: {
    orgId: string;
    orgName?: string;
    email: string;
    role: 'owner' | 'member';
    createOrg?: boolean;
    teamId?: string;
  },
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  if (input.createOrg === true) {
    await adapter.create({
      model: 'organization',
      data: {
        id: input.orgId,
        name: input.orgName ?? 'Audit Org',
        slug: `org-${input.orgId}`,
        createdAt: now,
      },
      forceAllowId: true,
    });
  }
  const user = await adapter.create<UserRow>({
    model: 'user',
    data: {
      name: input.role === 'owner' ? 'Audit Owner' : 'Workspace A Member',
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
      role: input.role,
      createdAt: now,
    },
  });
  if (input.teamId !== undefined) {
    await adapter.create({
      model: 'teamMember',
      data: { teamId: input.teamId, userId: user.id, createdAt: now },
    });
  }
  return user.id;
}

type Fixture = {
  app: Hono;
  auth: BetterAuthInstance;
  db: Db;
  services: Services;
  orgId: string;
  workspaceA: string;
  workspaceB: string;
  projectA: Awaited<ReturnType<typeof createProject>>;
  projectB: Awaited<ReturnType<typeof createProject>>;
  workspaceAKey: string;
  workspaceBKey: string;
  ownerUserId: string;
  ownerSession: Headers;
  memberSession: Headers;
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
  const ownerUserId = await seedUser(auth, {
    orgId,
    orgName: 'Audit Org',
    email: `owner-${orgId}@example.com`,
    role: 'owner',
    createOrg: true,
  });
  // Workspace A is deliberately first: current default-team selection chooses
  // the first team, which lets the scaffold repro show a workspace-B key
  // creating outside its own scope.
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
  const keyA = await createWorkspaceScopedAgentKey({
    auth,
    userId: ownerUserId,
    orgId,
    teamId: workspaceA,
    permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
    name: 'workspace-a-agent',
  });
  const keyB = await createWorkspaceScopedAgentKey({
    auth,
    userId: ownerUserId,
    orgId,
    teamId: workspaceB,
    permissions: DEFAULT_AGENT_KEY_PERMISSIONS,
    name: 'workspace-b-agent',
  });
  const memberUserId = await seedUser(auth, {
    orgId,
    email: `member-${orgId}@example.com`,
    role: 'member',
    teamId: workspaceA,
  });

  const services = createServices({ db, auth });
  const app = createApp({
    db,
    bindHost: '0.0.0.0',
    betterAuth: { secret: TEST_SECRET, baseURL: TEST_BASE_URL },
  });
  return {
    app,
    auth,
    db,
    services,
    orgId,
    workspaceA,
    workspaceB,
    projectA,
    projectB,
    workspaceAKey: keyA.key,
    workspaceBKey: keyB.key,
    ownerUserId,
    ownerSession: await mintSessionCookieHeader(auth, ownerUserId),
    memberSession: await mintSessionCookieHeader(auth, memberUserId),
  };
}

function bearer(key: string): { Authorization: string } {
  return { Authorization: `Bearer ${key}` };
}

function jsonHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;
  return { ...entries, 'Content-Type': 'application/json' };
}

function workspaceKeyContext(f: Fixture, workspaceId: string): AuthContext {
  return {
    kind: 'apikey',
    orgId: f.orgId,
    userId: f.ownerUserId,
    profile: 'agent',
    role: 'owner',
    workspaceId,
    permission: DEFAULT_AGENT_KEY_PERMISSIONS,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace-tier adversarial audit round 2', () => {
  it('goals: a workspace-A key cannot read, create, update, pause, resume, or complete workspace-B goals', async () => {
    const f = await fixture();
    const active = await createGoal(f.db, {
      projectId: f.projectB.id,
      objective: 'Workspace B active goal',
      status: 'active',
    });
    const paused = await createGoal(f.db, {
      projectId: f.projectB.id,
      objective: 'Workspace B paused goal',
      status: 'paused',
    });

    const requests = [
      f.app.request(`/api/v1/goals/${active.id}`, { headers: bearer(f.workspaceAKey) }),
      f.app.request(`/api/v1/projects/${f.projectB.id}/goals`, {
        method: 'POST',
        headers: jsonHeaders(bearer(f.workspaceAKey)),
        body: JSON.stringify({ objective: 'Escaped goal' }),
      }),
      f.app.request(`/api/v1/goals/${active.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(bearer(f.workspaceAKey)),
        body: JSON.stringify({ objective: 'Pwned' }),
      }),
      f.app.request(`/api/v1/goals/${active.id}/pause`, {
        method: 'POST',
        headers: bearer(f.workspaceAKey),
      }),
      f.app.request(`/api/v1/goals/${paused.id}/resume`, {
        method: 'POST',
        headers: bearer(f.workspaceAKey),
      }),
      f.app.request(`/api/v1/goals/${active.id}/complete`, {
        method: 'POST',
        headers: bearer(f.workspaceAKey),
      }),
    ];
    const responses = await Promise.all(requests.map((request) => Promise.resolve(request)));

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect((await getGoal(f.db, active.id))?.objective).toBe('Workspace B active goal');
    expect((await getGoal(f.db, active.id))?.status).toBe('active');
    expect((await getGoal(f.db, paused.id))?.status).toBe('paused');
  });

  it('reparenting: folder and document parents/folders must remain in the source project and scope', async () => {
    const f = await fixture();
    const folderA = await createFolder(f.db, { projectId: f.projectA.id, name: 'A folder' });
    const folderB = await createFolder(f.db, { projectId: f.projectB.id, name: 'B folder' });
    const documentA = await createDocument(f.db, { projectId: f.projectA.id, title: 'A doc' });
    const documentB = await createDocument(f.db, { projectId: f.projectB.id, title: 'B doc' });

    const folderCrossParent = await f.app.request(`/api/v1/folders/${folderA.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ parent_folder_id: folderB.id }),
    });
    const folderForeignSource = await f.app.request(`/api/v1/folders/${folderB.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ parent_folder_id: folderA.id }),
    });
    const documentCrossParent = await f.app.request(`/api/v1/documents/${documentA.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ parent_id: documentB.id, folder_id: folderB.id }),
    });
    const documentForeignSource = await f.app.request(`/api/v1/documents/${documentB.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ parent_id: documentA.id, folder_id: folderA.id }),
    });

    expect([
      folderCrossParent.status,
      folderForeignSource.status,
      documentCrossParent.status,
      documentForeignSource.status,
    ]).toEqual([400, 404, 400, 404]);
    expect((await getFolder(f.db, folderA.id))?.parentFolderId).toBeNull();
    expect((await getFolder(f.db, folderB.id))?.parentFolderId).toBeNull();
    expect((await getDocument(f.db, documentA.id))?.parentId).toBeNull();
    expect((await getDocument(f.db, documentA.id))?.folderId).toBeNull();
  });

  it('comments: task, note, and submission create/list/resolve are all workspace-scoped', async () => {
    const f = await fixture();
    const task = await createTask(f.db, {
      projectId: f.projectB.id,
      label: 'B task',
      status: 'todo',
    });
    const note = await createNote(f.db, { projectId: f.projectB.id, title: 'B note' });
    const { share } = await createShare(f.db, {
      projectId: f.projectB.id,
      audienceName: 'B client',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const submission = await createGuestSubmission(f.db, {
      projectId: f.projectB.id,
      hostedShareId: share.id,
      participantName: 'Client',
      title: 'B submission',
    });
    const targets = [
      { route: 'tasks', id: task.id, type: 'task' as const },
      { route: 'notes', id: note.id, type: 'note' as const },
      { route: 'submissions', id: submission.id, type: 'submission' as const },
    ];

    for (const target of targets) {
      const seeded = await createComment(f.db, {
        projectId: f.projectB.id,
        targetType: target.type,
        targetId: target.id,
        body: `secret ${target.type} comment`,
      });
      const list = await f.app.request(`/api/v1/${target.route}/${target.id}/comments`, {
        headers: bearer(f.workspaceAKey),
      });
      const create = await f.app.request(`/api/v1/${target.route}/${target.id}/comments`, {
        method: 'POST',
        headers: jsonHeaders(bearer(f.workspaceAKey)),
        body: JSON.stringify({ body: 'cross-workspace comment' }),
      });
      const resolve = await f.app.request(`/api/v1/comments/${seeded.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(bearer(f.workspaceAKey)),
        body: JSON.stringify({ resolved: true }),
      });

      expect({ list: list.status, rows: await parseJson<unknown[]>(list), create: create.status, resolve: resolve.status }).toEqual({
        list: 404,
        rows: [],
        create: 404,
        resolve: 404,
      });
      expect((await getComment(f.db, seeded.id))?.resolved).toBe(false);
    }
  });

  it('CONFIRMED REPRO — artifact comments with the same artifact id cannot bleed across projects', async () => {
    const f = await fixture();
    await createComment(f.db, {
      projectId: f.projectB.id,
      targetType: 'artifact',
      targetId: 'src/shared-name.ts',
      body: 'workspace B secret artifact comment',
    });

    const response = await f.app.request(
      `/api/v1/projects/${f.projectA.id}/artifact-comments?artifact_id=src%2Fshared-name.ts`,
      { headers: bearer(f.workspaceAKey) },
    );
    const rows = await parseJson<Array<{ body: string; project_id: string }>>(response);

    expect({ status: response.status, leakedBodies: rows.map((row) => row.body) }).toEqual({
      status: 200,
      leakedBodies: [],
    });
  });

  it('CONFIRMED REPRO — sync_pull cannot read a sibling remote or write submissions into its project', async () => {
    const f = await fixture();
    const remote = {
      serverUrl: 'https://sync.workspace-b.example',
      globalProjectId: 'workspace-b-global',
      syncToken: 'workspace-b-secret-token',
    };
    await setSyncRemote(f.db, f.projectB.id, remote);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'workspace-b-remote-submission',
            share_id: 'workspace-b-share',
            participant: { id: 'participant-b', name: 'Workspace B client' },
            title: 'Workspace B remote secret',
            body: 'remote secret body',
            severity: null,
            task_ref: null,
            status: 'pending',
            created_at: '2026-07-18T00:00:00.000Z',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await runWithAuthContext(workspaceKeyContext(f, f.workspaceA), async () => {
      const siblingRemote = await f.services.syncService.getRemote(f.projectB.id);
      if (siblingRemote === undefined) {
        return { remoteVisible: false, pulled: 0 };
      }
      const pulled = await f.services.syncService.pull(f.projectB.id, siblingRemote);
      return { remoteVisible: true, pulled: pulled.pulled };
    });

    expect({
      ...result,
      persisted: (await getSubmission(f.db, 'workspace-b-remote-submission')) !== undefined,
    }).toEqual({ remoteVisible: false, pulled: 0, persisted: false });
  });

  it('files: a workspace-A key cannot upload to or download from workspace B', async () => {
    const f = await fixture();
    const deniedUpload = await f.app.request(`/api/v1/projects/${f.projectB.id}/files`, {
      method: 'POST',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({
        filename: 'pwn.txt',
        mime: 'text/plain',
        content_base64: Buffer.from('write').toString('base64'),
      }),
    });
    const ownerUpload = await f.app.request(`/api/v1/projects/${f.projectB.id}/files`, {
      method: 'POST',
      headers: jsonHeaders(f.ownerSession),
      body: JSON.stringify({
        filename: 'secret.txt',
        mime: 'text/plain',
        content_base64: Buffer.from('workspace B secret').toString('base64'),
      }),
    });
    const file = await parseJson<{ url: string }>(ownerUpload);
    const deniedDownload = await f.app.request(file.url, { headers: bearer(f.workspaceAKey) });

    expect({ upload: deniedUpload.status, ownerUpload: ownerUpload.status, download: deniedDownload.status }).toEqual({
      upload: 404,
      ownerUpload: 201,
      download: 404,
    });
  });

  it('agent runs: start, progress, complete, list, and nested events stay in workspace B', async () => {
    const f = await fixture();
    const run = await createAgentRun(f.db, { projectId: f.projectB.id, label: 'B run' });
    const progress = await f.app.request(`/api/v1/agent-runs/${run.id}/progress`, {
      method: 'POST',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ message: 'cross-workspace event' }),
    });
    const list = await f.app.request(`/api/v1/projects/${f.projectB.id}/agent-runs`, {
      headers: bearer(f.workspaceAKey),
    });
    const direct = await runWithAuthContext(workspaceKeyContext(f, f.workspaceA), async () => ({
      start: await f.services.agentRunService.start(f.projectB.id, 'escaped run'),
      complete: await f.services.agentRunService.complete(run.id, 'completed'),
    }));

    expect({ progress: progress.status, list: list.status, ...direct }).toEqual({
      progress: 404,
      list: 404,
      start: undefined,
      complete: undefined,
    });
  });

  it('guest portal: a project guest cannot swap tokens or target a sibling project', async () => {
    const f = await fixture();
    const docA = await createDocument(f.db, {
      projectId: f.projectA.id,
      title: 'A shared doc',
      body: '<p>workspace A content</p>',
    });
    await createDocument(f.db, {
      projectId: f.projectB.id,
      title: 'B secret doc',
      body: '<p>workspace B portal secret</p>',
    });
    const shareA = await createShare(f.db, {
      projectId: f.projectA.id,
      audienceName: 'A client',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: [], documentIds: [docA.id], fields: {} },
    });
    const shareB = await createShare(f.db, {
      projectId: f.projectB.id,
      audienceName: 'B client',
      mode: 'public',
      permissions: { read: true, submit: true },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    const join = await f.app.request(`/api/v1/share/${shareA.token}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A guest' }),
    });
    const guest = await parseJson<{ session_token: string }>(join);
    const swappedView = await f.app.request(`/api/v1/share/${shareB.token}/view`, {
      headers: bearer(guest.session_token),
    });
    const submit = await f.app.request(`/api/v1/share/${shareA.token}/submissions`, {
      method: 'POST',
      headers: jsonHeaders(bearer(guest.session_token)),
      body: JSON.stringify({ title: 'Try sibling', project_id: f.projectB.id }),
    });
    const submitted = await parseJson<{ submission?: { id: string }; error?: string }>(submit);
    const markdown = await f.app.request(`/api/v1/share/${shareA.token}.md`);
    const markdownText = await markdown.text();

    expect({
      join: join.status,
      swappedView: swappedView.status,
      submit: submit.status,
      submitError: submitted.error,
      submissionProject:
        submitted.submission === undefined
          ? undefined
          : (await getSubmission(f.db, submitted.submission.id))?.projectId,
      markdown: markdown.status,
      leakedSibling: markdownText.includes('workspace B portal secret'),
    }).toEqual({
      join: 200,
      swappedView: 404,
      submit: 201,
      submitError: undefined,
      submissionProject: f.projectA.id,
      markdown: 200,
      leakedSibling: false,
    });
  });

  it('CONFIRMED REPRO — a workspace-A member cannot publish workspace B as a public portal', async () => {
    const f = await fixture();
    const response = await f.app.request(`/api/v1/workspaces/${f.workspaceB}/share`, {
      method: 'POST',
      headers: jsonHeaders(f.memberSession),
      body: JSON.stringify({ audience_name: 'Exfiltrate workspace B', mode: 'public' }),
    });
    const created = await parseJson<{ token?: string }>(response);
    let viewStatus = 404;
    let leakedProject = false;
    if (created.token !== undefined) {
      const join = await f.app.request(`/api/v1/share/${created.token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Attacker guest' }),
      });
      const guest = await parseJson<{ session_token?: string }>(join);
      if (guest.session_token !== undefined) {
        const view = await f.app.request(`/api/v1/share/${created.token}/view`, {
          headers: bearer(guest.session_token),
        });
        viewStatus = view.status;
        const body = await parseJson<{ projects?: Array<{ id: string }> }>(view);
        leakedProject = body.projects?.some((project) => project.id === f.projectB.id) === true;
      }
    }

    expect({ createStatus: response.status, viewStatus, leakedProject }).toEqual({
      createStatus: 404,
      viewStatus: 404,
      leakedProject: false,
    });
  });

  it('move/delete: a scoped key cannot move into/out of scope or delete a sibling project', async () => {
    const f = await fixture();
    const moveOut = await f.app.request(`/api/v1/projects/${f.projectA.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ workspace_id: f.workspaceB }),
    });
    const moveIn = await f.app.request(`/api/v1/projects/${f.projectB.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body: JSON.stringify({ workspace_id: f.workspaceA }),
    });
    const deleteSibling = await f.app.request(`/api/v1/projects/${f.projectB.id}`, {
      method: 'DELETE',
      headers: bearer(f.workspaceAKey),
    });

    expect({ moveOut: moveOut.status, moveIn: moveIn.status, deleteSibling: deleteSibling.status }).toEqual({
      moveOut: 403,
      moveIn: 403,
      deleteSibling: 403,
    });
    expect((await getProject(f.db, f.projectA.id))?.workspaceId).toBe(f.workspaceA);
    expect((await getProject(f.db, f.projectB.id))?.workspaceId).toBe(f.workspaceB);
  });

  it('invitations: neither a workspace key nor a workspace-A member can invite into workspace B', async () => {
    const f = await fixture();
    const body = JSON.stringify({
      email: 'outsider@example.com',
      role: 'member',
      team_id: f.workspaceB,
    });
    const keyAttempt = await f.app.request(`/api/v1/orgs/${f.orgId}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(bearer(f.workspaceAKey)),
      body,
    });
    const memberAttempt = await f.app.request(`/api/v1/orgs/${f.orgId}/invitations`, {
      method: 'POST',
      headers: jsonHeaders(f.memberSession),
      body,
    });

    expect({ key: keyAttempt.status, member: memberAttempt.status }).toEqual({ key: 403, member: 403 });
  });

  it('CONFIRMED REPRO — scaffold_project_from_plan must create in the scoped key workspace', async () => {
    const f = await fixture();
    const result = await runWithAuthContext(workspaceKeyContext(f, f.workspaceB), () =>
      f.services.projectService.scaffoldFromPlan({
        name: 'Workspace B scoped scaffold',
        tasks: [{ key: 'one', label: 'First task' }],
      }),
    );

    expect(result.project.workspace_id).toBe(f.workspaceB);
  });

  it('regression sanity: an owner session can create a project and list the full dashboard', async () => {
    const f = await fixture();
    const create = await f.app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(f.ownerSession),
      body: JSON.stringify({ name: 'Owner-created project', workspace_id: f.workspaceB }),
    });
    const created = await parseJson<{ id: string; workspace_id: string }>(create);
    const list = await f.app.request('/api/v1/projects', { headers: f.ownerSession });
    const projects = await parseJson<Array<{ id: string }>>(list);

    expect({
      create: create.status,
      workspace: created.workspace_id,
      list: list.status,
      hasA: projects.some((project) => project.id === f.projectA.id),
      hasB: projects.some((project) => project.id === f.projectB.id),
      hasCreated: projects.some((project) => project.id === created.id),
    }).toEqual({
      create: 201,
      workspace: f.workspaceB,
      list: 200,
      hasA: true,
      hasB: true,
      hasCreated: true,
    });
  });
});
