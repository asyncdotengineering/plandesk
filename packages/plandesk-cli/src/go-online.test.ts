import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { getRequestListener } from '@hono/node-server';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import {
  createApp,
  createBetterAuth,
  createOrgOwnerKey,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from '@plandesk/api';
import {
  DEFAULT_ORG_ID,
  createDb,
  createDocument,
  exportProject,
  listProjects,
  migrate,
} from '@plandesk/db';
import { createProjectInDefaultOrg as createProject, createTaskWithDefaultGoal as createTask } from '@plandesk/db/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { GoOnlineError, runGoOnline } from './go-online.js';
import { runInit } from './init.js';
import { openWorkspace } from './workspace.js';

const SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const BASE = 'http://127.0.0.1';

type BaUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type BaAccount = {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};
type BaOrg = { id: string; name: string; slug: string; createdAt: Date };
type BaMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

async function seedOwnerKey(
  auth: BetterAuthInstance,
  org: { id: string; name: string; slug: string },
  email: string,
  githubAccountId: string,
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BaUser>({
    model: 'user',
    data: { name: email, email, emailVerified: true, image: null, createdAt: now, updatedAt: now },
  });
  await adapter.create<BaAccount>({
    model: 'account',
    data: { accountId: githubAccountId, providerId: 'github', userId: user.id, createdAt: now, updatedAt: now },
  });
  // forceAllowId accepts id at runtime, but TS excess-property check rejects an
  // inline literal — assign to an intermediate first (see invitations.test.ts).
  const orgData: BaOrg = { id: org.id, name: org.name, slug: org.slug, createdAt: now };
  await adapter.create<BaOrg>({
    model: 'organization',
    data: orgData,
    forceAllowId: true,
  });
  await adapter.create<BaMember>({
    model: 'member',
    data: { organizationId: org.id, userId: user.id, role: 'owner', createdAt: now },
  });
  const minted = await createOrgOwnerKey({ auth, userId: user.id, orgId: org.id, name: 'go-online' });
  return minted.key;
}

type Hosted = {
  serverUrl: string;
  orgId: string;
  token: string;
  db: Awaited<ReturnType<typeof createDb>>;
  close: () => void;
};

async function startHosted(): Promise<Hosted> {
  const db = await createDb(':memory:');
  await migrate(db);
  const orgId = randomUUID();
  const auth = createBetterAuth({
    client: db.$client,
    secret: SECRET,
    baseURL: BASE,
    github: { clientId: 'c', clientSecret: 's' },
  });
  if (auth === undefined) throw new Error('expected better-auth');
  await runBetterAuthMigrations(auth);
  const token = await seedOwnerKey(auth, { id: orgId, name: 'Hosted', slug: 'hosted' }, 'owner@go-online.test', '7001');
  const app = createApp({
    db,
    bindHost: '0.0.0.0',
    betterAuth: { secret: SECRET, baseURL: BASE },
    github: { clientId: 'c', clientSecret: 's', callbackUrl: 'https://x.test/cb' },
  });
  const server = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('expected TCP address');
  return {
    serverUrl: `http://127.0.0.1:${String(addr.port)}`,
    orgId,
    token,
    db,
    close: () => server.close(),
  };
}

type LocalBoard = {
  dataDir: string;
  /** workspace names → local team ids */
  teams: Map<string, string>;
  /** workspace name → project ids */
  projects: Map<string, string[]>;
};

async function makeLocalBoard(): Promise<LocalBoard> {
  const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-go-online-local-'));
  await runInit(dataDir);
  const { db } = await openWorkspace(dataDir);
  // Build a better-auth instance against the local board so we can add a team.
  const localAuth = createBetterAuth({
    client: db.$client,
    secret: SECRET,
    baseURL: BASE,
  });
  if (localAuth === undefined) throw new Error('expected local better-auth');
  await runBetterAuthMigrations(localAuth);

  const teams = new Map<string, string>();
  const projects = new Map<string, string[]>();

  // openWorkspace seeds the default "General" team (DEFAULT_WORKSPACE_ID).
  const generalTeamId = await ensureDefaultGeneralTeamId(db);
  teams.set('General', generalTeamId);

  // Second workspace, created via the same adapter path identity.ts uses.
  const adapter = (await localAuth.$context).adapter;
  const fiji = await adapter.create<{ id: string; name: string; organizationId: string; createdAt: Date }>({
    model: 'team',
    data: { name: 'Fiji TV', organizationId: DEFAULT_ORG_ID, createdAt: new Date() },
  });
  teams.set('Fiji TV', fiji.id);

  // One project with a task + a document in each workspace.
  for (const [name, teamId] of teams) {
    const project = await createProject(db, {
      name: `${name} Project`,
      orgId: DEFAULT_ORG_ID,
      workspaceId: teamId,
    });
    const task = await createTask(db, {
      projectId: project.id,
      label: `${name} task`,
      status: 'todo',
      description: `work for ${name}`,
    });
    await createDocument(db, {
      projectId: project.id,
      title: `${name} spec`,
      body: `## Why\n${name} needs this.`,
    });
    projects.set(name, [project.id]);
  }

  return { dataDir, teams, projects };
}

/** The local default "General" team id (DEFAULT_WORKSPACE_ID after init). */
async function ensureDefaultGeneralTeamId(db: Awaited<ReturnType<typeof createDb>>): Promise<string> {
  const result = await db.$client.execute({
    sql: "SELECT id FROM team WHERE organizationId = ? AND name = 'General' LIMIT 1",
    args: [DEFAULT_ORG_ID],
  });
  const id = result.rows[0]?.['id'];
  if (typeof id !== 'string' || id === '') throw new Error('default General team missing');
  return id;
}

function silentOut(): Writable {
  return new Writable({ write(_chunk, _enc, cb) { cb(); } });
}

describe('plandesk go-online', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn !== undefined) fn();
    }
  });

  it('test:go_online_all — pushes every local workspace + project; workspace_id matches hosted team; tasks/docs survive', async () => {
    const hosted = await startHosted();
    cleanup.push(hosted.close);
    const local = await makeLocalBoard();
    cleanup.push(() => rmSync(local.dataDir, { recursive: true, force: true }));

    const result = await runGoOnline({
      all: true,
      to: hosted.orgId,
      server: hosted.serverUrl,
      token: hosted.token,
      dataDir: local.dataDir,
      out: silentOut(),
    });

    expect(result.pushedWorkspaces).toBe(2);
    expect(result.pushedProjects).toBe(2);

    // Hosted org now has both workspaces, by name.
    const hostedTeams = await hostedTeamNames(hosted);
    expect(hostedTeams.sort()).toEqual(['Fiji TV', 'General'].sort());

    // Each local project survived the round-trip and landed in its hosted team.
    const { db: localDb } = await openWorkspace(local.dataDir);
    for (const teamName of ['General', 'Fiji TV'] as const) {
      const localProjectId = local.projects.get(teamName)?.[0];
      if (localProjectId === undefined) throw new Error(`missing local project for ${teamName}`);
      const localExport = await exportProject(localDb, localProjectId);
      expect(localExport).toBeDefined();
      if (!localExport) continue;

      const hostedProjects = await listProjects(hosted.db, hosted.orgId);
      const hostedProject = hostedProjects.find((p) => p.name === `${teamName} Project`);
      expect(hostedProject).toBeDefined();
      if (!hostedProject) continue;

      // DoD: each hosted project's workspace_id = its hosted team.
      const hostedTeamId = result.perWorkspace.find((ws) => ws.name === teamName)?.hostedTeamId;
      expect(hostedTeamId).toBeDefined();
      expect(hostedProject.workspaceId).toBe(hostedTeamId);

      const hostedExport = await exportProject(hosted.db, hostedProject.id);
      expect(hostedExport).toBeDefined();
      if (!hostedExport) continue;
      expect(hostedExport.tasks.map((t) => t.label)).toEqual([`${teamName} task`]);
      expect(hostedExport.documents.map((d) => d.title)).toEqual([`${teamName} spec`]);
      expect(hostedExport.documents[0]?.body).toBe(`## Why\n${teamName} needs this.`);
    }
  });

  it('test:go_online_workspace_filter --workspace <one> pushes only that workspace', async () => {
    const hosted = await startHosted();
    cleanup.push(hosted.close);
    const local = await makeLocalBoard();
    cleanup.push(() => rmSync(local.dataDir, { recursive: true, force: true }));

    const result = await runGoOnline({
      workspaces: ['Fiji TV'],
      to: hosted.orgId,
      server: hosted.serverUrl,
      token: hosted.token,
      dataDir: local.dataDir,
      out: silentOut(),
    });

    expect(result.pushedWorkspaces).toBe(1);
    expect(result.pushedProjects).toBe(1);
    expect(result.perWorkspace[0]?.name).toBe('Fiji TV');

    const hostedProjects = await listProjects(hosted.db, hosted.orgId);
    expect(hostedProjects.map((p) => p.name)).toEqual(['Fiji TV Project']);
  });

  it('test:go_online_idempotent — re-run creates no duplicate teams or projects', async () => {
    const hosted = await startHosted();
    cleanup.push(hosted.close);
    const local = await makeLocalBoard();
    cleanup.push(() => rmSync(local.dataDir, { recursive: true, force: true }));

    const opts = {
      all: true,
      to: hosted.orgId,
      server: hosted.serverUrl,
      token: hosted.token,
      dataDir: local.dataDir,
      out: silentOut(),
    } as const;

    const first = await runGoOnline(opts);
    expect(first.pushedProjects).toBe(2);

    const second = await runGoOnline(opts);
    expect(second.pushedProjects).toBe(0);
    expect(second.perWorkspace.map((ws) => ws.skipped)).toEqual([1, 1]);

    // Still exactly 2 hosted teams and 2 hosted projects.
    expect((await hostedTeamNames(hosted)).length).toBe(2);
    expect((await listProjects(hosted.db, hosted.orgId)).length).toBe(2);
  });

  it('test:go_online_unknown_workspace — unknown --workspace name is a clear error', async () => {
    const hosted = await startHosted();
    cleanup.push(hosted.close);
    const local = await makeLocalBoard();
    cleanup.push(() => rmSync(local.dataDir, { recursive: true, force: true }));

    await expect(
      runGoOnline({
        workspaces: ['Does Not Exist'],
        to: hosted.orgId,
        server: hosted.serverUrl,
        token: hosted.token,
        dataDir: local.dataDir,
        out: silentOut(),
      }),
    ).rejects.toThrow(GoOnlineError);
  });

  it('test:go_online_no_target — missing hosted target is a clear error', async () => {
    const local = await makeLocalBoard();
    cleanup.push(() => rmSync(local.dataDir, { recursive: true, force: true }));

    await expect(
      runGoOnline({ all: true, dataDir: local.dataDir, home: '/nonexistent-home-zz', out: silentOut() }),
    ).rejects.toThrow(GoOnlineError);
  });
});

async function hostedTeamNames(hosted: Hosted): Promise<string[]> {
  const result = await hosted.db.$client.execute({
    sql: 'SELECT name FROM team WHERE organizationId = ?',
    args: [hosted.orgId],
  });
  return result.rows.map((row) => String(row['name'] ?? ''));
}
