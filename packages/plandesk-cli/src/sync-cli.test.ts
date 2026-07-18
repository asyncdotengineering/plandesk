import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { getRequestListener } from '@hono/node-server';
import { join } from 'node:path';
import {
  createApp,
  createBetterAuth,
  createOrgOwnerKey,
  createServices,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from '@plandesk/api';
import {
  DEFAULT_ORG_ID,
  createProjectInDefaultOrg as createProject,
  exportProject,
  getSyncRemote,
  listSubmissions,
  migrate,
  createDb,
} from '@plandesk/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from './args.js';
import { buildConfigJson, parseConfigJson } from './connect-artifacts.js';
import { main } from './cli.js';
import { runInit } from './init.js';
import { openWorkspace } from './workspace.js';


const SYNC_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';
const SYNC_BASE = 'http://127.0.0.1';

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
    data: {
      name: email,
      email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BaAccount>({
    model: 'account',
    data: {
      accountId: githubAccountId,
      providerId: 'github',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  const existing = await adapter.findOne<BaOrg>({
    model: 'organization',
    where: [{ field: 'id', value: org.id }],
  });
  if (existing === null) {
    const orgData = { id: org.id, name: org.name, slug: org.slug, createdAt: now };
    await adapter.create<BaOrg>({
      model: 'organization',
      data: orgData,
      forceAllowId: true,
    });
  }
  await adapter.create<BaMember>({
    model: 'member',
    data: {
      organizationId: org.id,
      userId: user.id,
      role: 'owner',
      createdAt: now,
    },
  });
  const minted = await createOrgOwnerKey({
    auth,
    userId: user.id,
    orgId: org.id,
    name: 'sync-push',
  });
  return minted.key;
}

async function captureIo(
  run: () => Promise<number> | number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  let code = 1;
  try {
    code = await Promise.resolve(run());
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    code,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

describe('parseArgs push/pull', () => {
  it('parses push and pull with project and repo', async () => {
    expect(
      parseArgs([
        'node',
        'plandesk',
        'push',
        '--project',
        'proj-1',
        '--repo',
        '/tmp/repo',
        '--data-dir',
        '/tmp/ws',
      ]),
    ).toEqual({
      command: 'push',
      projectId: 'proj-1',
      repoDir: '/tmp/repo',
      dataDir: '/tmp/ws',
      toOrgId: undefined,
      remoteUrl: undefined,
    });
    expect(
      parseArgs([
        'node',
        'plandesk',
        'push',
        '--project',
        'proj-1',
        '--to',
        'org-abc',
        '--url',
        'https://api.example',
      ]),
    ).toEqual({
      command: 'push',
      projectId: 'proj-1',
      toOrgId: 'org-abc',
      remoteUrl: 'https://api.example',
      repoDir: undefined,
      dataDir: undefined,
    });
    expect(
      parseArgs(['node', 'plandesk', 'pull', '--project', 'proj-1', '--data-dir', '/tmp/ws']),
    ).toEqual({
      command: 'pull',
      projectId: 'proj-1',
      dataDir: '/tmp/ws',
    });
  });
});

describe('CLI push/pull', () => {
  const tempDirs: string[] = [];
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    while (servers.length > 0) {
      servers.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    vi.unstubAllEnvs();
  });

  async function makeWorkspace(): Promise<{
    dataDir: string;
    repoDir: string;
    projectId: string;
    orgId: string;
  }> {
    const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-sync-cli-ws-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-sync-cli-repo-'));
    tempDirs.push(dataDir, repoDir);
    await runInit(dataDir);
    const { db } = await openWorkspace(dataDir);
    const project = await createProject(db, { name: 'Sync CLI' });
    mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({
        serverUrl: 'http://127.0.0.1:3847',
        projectId: project.id,
        projectName: project.name,
      }),
    );
    return { dataDir, repoDir, projectId: project.id, orgId: project.orgId };
  }

  it('share create mints a participant token and stores only its hash', async () => {
    const { dataDir, repoDir, projectId, orgId } = await makeWorkspace();

    const { code, stdout } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'share',
        'create',
        '--audience',
        'Acme Corp',
        '--public',
        '--allow-submit',
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Share created for "Acme Corp" (public)');
    const tokenMatch = /plandesk_share_[A-Za-z0-9_-]+/.exec(stdout);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch?.[0] ?? '';

    const { db } = await openWorkspace(dataDir);
    const { shareService } = createServices({ db, orgId });
    const shares = await (await shareService.listShares(projectId)) ?? [];
    expect(shares).toHaveLength(1);
    expect(shares[0]?.audience_name).toBe('Acme Corp');
    expect(shares[0]?.mode).toBe('public');
    expect(shares[0]?.permissions).toEqual({ read: true, submit: true });
    // the plaintext token is never persisted — only its sha256 hash
    expect(JSON.stringify(shares)).not.toContain(token);
  });

  it('share create rejects a missing audience', async () => {
    const { dataDir, repoDir } = await makeWorkspace();
    const { code, stderr } = await captureIo(() =>
      main(['node', 'plandesk', 'share', 'create', '--repo', repoDir, '--data-dir', dataDir]),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command: share create (missing --audience)');
  });

  it('share create rejects an invalid --expires', async () => {
    const { dataDir, repoDir } = await makeWorkspace();
    const { code, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'share',
        'create',
        '--audience',
        'Acme',
        '--expires',
        'soon',
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid --expires');
  });

  it('single-server: guest submit lands in owner triage without a separate sync-server', async () => {
    // BA6b: guest submit writes share_submissions on plandesk-api; owner lists locally.
    const hostedDb = await createDb(':memory:');
    await migrate(hostedDb);
    const org = { id: DEFAULT_ORG_ID, name: 'Personal' };
    const project = await createProject(hostedDb, { name: 'Hosted collab' });
    const services = createServices({ db: hostedDb, orgId: org.id });
    const hostedApp = createApp({ db: hostedDb, services, bindHost: '127.0.0.1' });
    const server = createServer(getRequestListener(hostedApp.fetch));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);

    const created = await services.shareService.createShare(project.id, {
      audienceName: 'Acme',
      mode: 'public',
      permissions: { read: true, submit: true },
    });
    if (!created) {
      throw new Error('expected share');
    }

    const joinRes = await hostedApp.request(`/api/v1/share/${created.token}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex' }),
    });
    expect(joinRes.status).toBe(200);
    const { session_token: sessionToken } = (await joinRes.json()) as { session_token: string };

    const submitRes = await hostedApp.request(`/api/v1/share/${created.token}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ title: 'Client bug', body: 'Broken on mobile', severity: 'high' }),
    });
    expect(submitRes.status).toBe(201);
    const submitBody = (await submitRes.json()) as {
      submission: { id: string; title: string; status: string };
    };
    expect(submitBody.submission.title).toBe('Client bug');
    expect(submitBody.submission.status).toBe('pending');

    const listRes = await hostedApp.request(`/api/v1/share/${created.token}/submissions`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(listRes.status).toBe(200);
    const mine = (await listRes.json()) as Array<{ title: string }>;
    expect(mine.map((s) => s.title)).toEqual(['Client bug']);

    const triage = await services.syncService.listTriage(project.id, 'pending');
    expect(triage).toHaveLength(1);
    expect(triage[0]?.title).toBe('Client bug');
    expect(triage[0]?.participant_name).toBe('Alex');
    expect(await listSubmissions(hostedDb, project.id, 'pending')).toHaveLength(1);

    const accepted = await services.syncService.triage(submitBody.submission.id, 'accept');
    expect(accepted.status).toBe('accepted');
    expect(accepted.linked_task_id).toBeTruthy();
    expect(await listSubmissions(hostedDb, project.id, 'pending')).toHaveLength(0);
  });

  it('push --to promotes local project into a hosted org and rewrites config', async () => {
    // Hosted API workspace (org authority target).
    const hostedDb = await createDb(':memory:');
    await migrate(hostedDb);
    const org = { id: DEFAULT_ORG_ID, name: 'Personal' };
    const auth = createBetterAuth({
      client: hostedDb.$client,
      secret: SYNC_SECRET,
      baseURL: SYNC_BASE,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    const token = await seedOwnerKey(
      auth,
      { id: org.id, name: org.name, slug: 'default' },
      'promote@sync.test',
      '8201',
    );
    const hostedApp = createApp({
      db: hostedDb,
      bindHost: '0.0.0.0',
      betterAuth: { secret: SYNC_SECRET, baseURL: SYNC_BASE },
      github: { clientId: 'c', clientSecret: 's', callbackUrl: 'https://x.test/cb' },
    });
    const server = createServer(getRequestListener(hostedApp.fetch));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('expected TCP address');
    }
    const serverUrl = `http://127.0.0.1:${String(addr.port)}`;

    const { dataDir, repoDir, projectId } = await makeWorkspace();
    // Point config + token at the hosted API for promote.
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({
        serverUrl,
        projectId,
        projectName: 'Sync CLI',
      }),
    );
    writeFileSync(join(repoDir, '.plandesk', 'token'), `${token}\n`, 'utf8');

    const { code, stdout, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'push',
        '--project',
        projectId,
        '--to',
        org.id,
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Promoted to org');
    expect(stdout).toContain(org.id);

    const config = parseConfigJson(readFileSync(join(repoDir, '.plandesk', 'config.json'), 'utf8'));
    expect(config.serverUrl).toBe(serverUrl);
    expect(config.orgId).toBe(org.id);
    expect(config.projectId).not.toBe(projectId);

    const hostedExport = await exportProject(hostedDb, config.projectId);
    expect(hostedExport?.project.name).toBe('Sync CLI');

    const { db: localDb } = await openWorkspace(dataDir);
    const remote = await getSyncRemote(localDb, projectId);
    expect(remote?.globalProjectId).toBe(config.projectId);
    expect(remote?.serverUrl).toBe(serverUrl);

    const columns = await localDb.$client.execute('PRAGMA table_info(projects)');
    const names = columns.rows.map((row) => String(row['name'] ?? row[1])).sort();
    expect(names).toEqual([
      'canvas_layout',
      'created_at',
      'description',
      'id',
      'name',
      'org_id',
      'updated_at',
      'workspace_id',
    ]);
  });

  it('push --to with wrong-org token is rejected', async () => {
    const hostedDb = await createDb(':memory:');
    await migrate(hostedDb);
    const orgA = { id: DEFAULT_ORG_ID, name: 'Personal' };
    const orgB = { id: randomUUID(), name: 'Other' };
    const auth = createBetterAuth({
      client: hostedDb.$client,
      secret: SYNC_SECRET,
      baseURL: SYNC_BASE,
      github: { clientId: 'c', clientSecret: 's' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    const tokenA = await seedOwnerKey(
      auth,
      { id: orgA.id, name: orgA.name, slug: 'org-a' },
      'a@sync.test',
      '8202',
    );
    const hostedApp = createApp({
      db: hostedDb,
      bindHost: '0.0.0.0',
      betterAuth: { secret: SYNC_SECRET, baseURL: SYNC_BASE },
      github: { clientId: 'c', clientSecret: 's', callbackUrl: 'https://x.test/cb' },
    });
    const server = createServer(getRequestListener(hostedApp.fetch));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    servers.push(server);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('expected TCP address');
    }
    const serverUrl = `http://127.0.0.1:${String(addr.port)}`;

    const { dataDir, repoDir, projectId } = await makeWorkspace();
    writeFileSync(
      join(repoDir, '.plandesk', 'config.json'),
      buildConfigJson({
        serverUrl,
        projectId,
        projectName: 'Sync CLI',
      }),
    );
    writeFileSync(join(repoDir, '.plandesk', 'token'), `${tokenA}\n`, 'utf8');

    const { code, stderr } = await captureIo(() =>
      main([
        'node',
        'plandesk',
        'push',
        '--project',
        projectId,
        '--to',
        orgB.id,
        '--repo',
        repoDir,
        '--data-dir',
        dataDir,
      ]),
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/promote failed|not_found/i);
  });
});
