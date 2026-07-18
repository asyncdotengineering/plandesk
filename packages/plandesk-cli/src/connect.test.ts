import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRequestListener } from '@hono/node-server';
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
  DEFAULT_WORKSPACE_ID,
  createDb,
  createProject as createProjectInOrg,
  createProjectInDefaultOrg as createProject,
  createTaskWithDefaultGoal as createTask,
  migrate,
  type Db,
} from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { writeCliConfig } from './config.js';
import { parseConfigJson, SENTINEL_START } from './connect-artifacts.js';
import { ConnectError, formatConnectPrint, runConnect } from './connect.js';
import { runDisconnect } from './disconnect.js';
import { runBindingDoctor } from './binding-doctor.js';
import { main } from './cli.js';

const HOSTED_SECRET = 'test-secret-not-a-real-one-0123456789abcdef';

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

async function seedOwnerUser(
  auth: BetterAuthInstance,
  org: { id: string; name: string; slug: string },
): Promise<string> {
  const adapter = (await auth.$context).adapter;
  const now = new Date();
  const user = await adapter.create<BetterAuthUser>({
    model: 'user',
    data: {
      name: 'Owner',
      email: 'owner-connect@example.com',
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  await adapter.create<BetterAuthAccount>({
    model: 'account',
    data: {
      accountId: 'gh-connect-8401',
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

async function withTestServer(
  run: (ctx: { baseUrl: string; db: Db; projectId: string; projectName: string }) => Promise<void>,
): Promise<void> {
  const db = await createDb(':memory:');
  await migrate(db);
  const project = await createProject(db, { name: 'connect-repo' });
  const services = createServices({ db, orgId: project.orgId });
  const mcpApp = createMcpApp({ services });
  const app = createApp({ db, services, mcp: mcpApp });

  const server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('expected TCP address');
  }

  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  try {
    await run({ baseUrl, db, projectId: project.id, projectName: project.name });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

function committedContents(repoDir: string): string {
  const paths = [
    '.plandesk/config.json',
    '.plandesk/skill.md',
    '.mcp.json',
    'CLAUDE.md',
    'AGENTS.md',
    '.codex/commands/plandesk.md',
    '.gitignore',
  ];
  return paths
    .map((relativePath) => {
      const path = join(repoDir, relativePath);
      return existsSync(path) ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');
}

describe('runConnect', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function makeRepo(name = 'connect-repo'): string {
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-connect-'));
    tempDirs.push(repoDir);
    writeFileSync(join(repoDir, 'README.md'), `# ${name}\n`, 'utf8');
    return repoDir;
  }

  it('writes connect artifacts with env-var mcp config (local: no token file)', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);

      const result = await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        agent: 'both',
        interactive: false,
      });

      expect(result.project.id).toBe(projectId);
      expect(existsSync(join(repoDir, '.plandesk', 'token'))).toBe(false);
      expect(committedContents(repoDir)).not.toContain('plandesk_mcp_');
      const mcpJson = readFileSync(join(repoDir, '.mcp.json'), 'utf8');
      expect(mcpJson).toContain('headersHelper');
      expect(readFileSync(join(repoDir, 'CLAUDE.md'), 'utf8')).toContain(SENTINEL_START);
      expect(readFileSync(join(repoDir, '.claude/commands/plandesk.md'), 'utf8')).toContain(
        '@.plandesk/skill.md',
      );
      for (const skillDir of ['.claude/skills/plandesk', '.agents/skills/plandesk']) {
        const linkPath = join(repoDir, skillDir, 'SKILL.md');
        expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
        const linked = readFileSync(linkPath, 'utf8');
        expect(linked).toContain('name: plandesk');
        expect(linked).toBe(readFileSync(join(repoDir, '.plandesk', 'skill.md'), 'utf8'));
      }
      const gitignore = readFileSync(join(repoDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.plandesk/token');
      expect(gitignore).toContain('.plandesk/server.json');
      expect(
        parseConfigJson(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8')).projectId,
      ).toBe(projectId);
    });
  });

  it('is idempotent on re-run', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const opts = {
        repoDir,
        project: projectId,
        url: baseUrl,
        token: 'plandesk_mcp_test_token_value_0123456789',
        agent: 'both' as const,
        interactive: false,
      };

      await runConnect(opts);
      const first = {
        config: readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8'),
        claude: readFileSync(join(repoDir, 'CLAUDE.md'), 'utf8'),
        gitignore: readFileSync(join(repoDir, '.gitignore'), 'utf8'),
        mcp: readFileSync(join(repoDir, '.mcp.json'), 'utf8'),
      };

      await runConnect(opts);
      expect(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8')).toBe(first.config);
      expect(readFileSync(join(repoDir, 'CLAUDE.md'), 'utf8')).toBe(first.claude);
      expect(readFileSync(join(repoDir, '.gitignore'), 'utf8')).toBe(first.gitignore);
      expect(readFileSync(join(repoDir, '.mcp.json'), 'utf8')).toBe(first.mcp);
      expect(
        readFileSync(join(repoDir, 'CLAUDE.md'), 'utf8').match(/plandesk:start/g)?.length,
      ).toBe(1);
    });
  });

  it('supports --print without writing files', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const result = await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token: 'plandesk_mcp_print_mode_token',
        print: true,
        interactive: false,
      });

      const output = formatConnectPrint(result);
      expect(output).toContain('CREATE');
      expect(output).toContain('.plandesk/config.json');
      expect(output).not.toContain('plandesk_mcp_print_mode_token');
      expect(existsSync(join(repoDir, '.plandesk'))).toBe(false);
    });
  });

  it('disconnect removes connect artifacts cleanly', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token: 'plandesk_mcp_disconnect_token_value',
        agent: 'both',
        interactive: false,
      });

      const removed = runDisconnect({ repoDir });
      expect(removed.removed.length).toBeGreaterThan(0);
      expect(existsSync(join(repoDir, '.plandesk'))).toBe(false);
      expect(existsSync(join(repoDir, '.codex/commands/plandesk.md'))).toBe(false);
      expect(existsSync(join(repoDir, '.claude/commands/plandesk.md'))).toBe(false);
      expect(existsSync(join(repoDir, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(repoDir, '.mcp.json'))).toBe(false);
      expect(lstatSync(join(repoDir, '.claude/skills/plandesk'), { throwIfNoEntry: false })).toBe(
        undefined,
      );
      expect(lstatSync(join(repoDir, '.agents/skills/plandesk'), { throwIfNoEntry: false })).toBe(
        undefined,
      );
    });
  });

  it('allows explicit rebind with --project', async () => {
    await withTestServer(async ({ baseUrl, db, projectId }) => {
      const repoDir = makeRepo('connect-repo');
      const other = await createProject(db, { name: 'other-project' });
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token: 'plandesk_mcp_rebind_token_value_123',
        interactive: false,
      });

      const rebound = await runConnect({
        repoDir,
        project: other.id,
        url: baseUrl,
        token: 'plandesk_mcp_rebind_token_value_123',
        interactive: false,
      });

      expect(rebound.project.id).toBe(other.id);
      expect(
        parseConfigJson(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8')).projectId,
      ).toBe(other.id);
    });
  });

  it('validates binding via doctor (local loopback, no token file)', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        interactive: false,
      });

      const report = await runBindingDoctor(repoDir);
      expect(report.present).toBe(true);
      expect(report.serverReachable).toBe(true);
      expect(report.tokenValid).toBe(true);
      expect(report.projectExists).toBe(true);
      expect(report.issues).toEqual([]);
    });
  });

  it('reports token invalid when a bound stranger bearer is present', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token: 'plandesk_mcp_revoked_or_stranger',
        interactive: false,
      });

      const report = await runBindingDoctor(repoDir);
      expect(report.serverReachable).toBe(true);
      // Stranger bearer is not a better-auth key → MCP 401.
      expect(report.tokenValid).toBe(false);
      expect(report.mcpToolCount).toBe(0);
      expect(report.issues).toContain('token invalid or revoked');
    });
  });

  it('test:local_mode_unchanged — no --to uses loopback owner, no token file', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const result = await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        agent: 'claude',
        interactive: false,
      });
      expect(result.tokenCreated).toBe(false);
      expect(result.serverUrl).toBe(baseUrl.replace(/\/$/, ''));
      expect(existsSync(join(repoDir, '.plandesk', 'token'))).toBe(false);
      expect(result.tokenLine).toMatch(/loopback/i);
    });
  });
});

describe('runConnect --to hosted (BA4b-3)', () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    while (servers.length > 0) {
      const server = servers.pop();
      server?.close();
    }
  });

  it('gate 4: connect --to writes scoped agent key; authorizes project p, 404s other project', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const org = { id: randomUUID(), name: 'Hosted Connect Org' };
    const projectA = await createProjectInOrg(db, { name: 'hosted-board', orgId: org.id, workspaceId: DEFAULT_WORKSPACE_ID });
    const projectB = await createProjectInOrg(db, { name: 'other-board', orgId: org.id, workspaceId: DEFAULT_WORKSPACE_ID });
    await createTask(db, { projectId: projectA.id, label: 'A task', status: 'todo' });
    await createTask(db, { projectId: projectB.id, label: 'B task', status: 'todo' });

    const testBase = 'http://127.0.0.1';
    const auth = createBetterAuth({
      client: db.$client,
      secret: HOSTED_SECRET,
      baseURL: testBase,
      github: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    const userId = await seedOwnerUser(auth, {
      id: org.id,
      name: org.name,
      slug: 'hosted-connect',
    });
    const ownerKey = await createOrgOwnerKey({
      auth,
      userId,
      orgId: org.id,
      name: 'cli-owner',
    });

    const app = createApp({
      db,
      bindHost: '0.0.0.0',
      github: {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        callbackUrl: `${testBase}/api/v1/auth/github/callback`,
        dashboardUrl: '/',
      },
      betterAuth: { secret: HOSTED_SECRET, baseURL: testBase },
    });

    const server = createServer((req, res) => {
      void getRequestListener(app.fetch)(req, res);
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address !== 'object') {
      throw new Error('expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;

    const home = mkdtempSync(join(tmpdir(), 'plandesk-home-'));
    tempDirs.push(home);
    writeCliConfig({ server: baseUrl, token: ownerKey.key, orgId: org.id }, home);

    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-hosted-connect-'));
    tempDirs.push(repoDir);
    writeFileSync(join(repoDir, 'README.md'), '# hosted-board\n', 'utf8');

    const result = await runConnect({
      repoDir,
      to: org.id,
      project: projectA.id,
      home,
      agent: 'claude',
      interactive: false,
    });

    expect(result.project.id).toBe(projectA.id);
    expect(result.serverUrl).toBe(baseUrl.replace(/\/$/, ''));
    expect(result.tokenCreated).toBe(true);

    const writtenToken = readFileSync(join(repoDir, '.plandesk', 'token'), 'utf8').trim();
    // Must be the scoped agent key — never the owner key from login config.
    expect(writtenToken).not.toBe(ownerKey.key);
    expect(writtenToken.length).toBeGreaterThan(0);

    const bound = parseConfigJson(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8'));
    expect(bound.projectId).toBe(projectA.id);
    expect(bound.serverUrl).toBe(baseUrl.replace(/\/$/, ''));

    // Scoped key works on project A, 404s on B.
    const onA = await fetch(`${baseUrl}/api/v1/projects/${projectA.id}/tasks`, {
      headers: { Authorization: `Bearer ${writtenToken}` },
    });
    expect(onA.status).toBe(200);

    const onB = await fetch(`${baseUrl}/api/v1/projects/${projectB.id}/tasks`, {
      headers: { Authorization: `Bearer ${writtenToken}` },
    });
    expect(onB.status).toBe(404);

    // Owner key still cannot be what agents use — agent key cannot mint.
    const escalate = await fetch(`${baseUrl}/api/v1/orgs/${org.id}/agent-keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writtenToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_id: projectA.id }),
    });
    expect(escalate.status).toBe(403);
  });

  it('hosted connect without login → clear error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'plandesk-home-empty-'));
    tempDirs.push(home);
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-hosted-nologin-'));
    tempDirs.push(repoDir);

    await expect(
      runConnect({
        repoDir,
        to: 'org-missing',
        project: 'p1',
        home,
        interactive: false,
      }),
    ).rejects.toBeInstanceOf(ConnectError);

    try {
      await runConnect({
        repoDir,
        to: 'org-missing',
        project: 'p1',
        home,
        interactive: false,
      });
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).message).toContain('plandesk login');
    }
  });
});

describe('CLI connect/disconnect', () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    while (servers.length > 0) {
      const server = servers.pop();
      server?.close();
    }
  });

  it('dispatches connect via main', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'cli-connect' });
        const services = createServices({ db, orgId: project.orgId });
    const mcpApp = createMcpApp({ services });
    const app = createApp({ db, services, mcp: mcpApp });
    const server = createServer((req, res) => {
      void getRequestListener(app.fetch)(req, res);
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address !== 'object') {
      throw new Error('expected TCP address');
    }
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;

    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-cli-connect-'));
    tempDirs.push(repoDir);

    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const code = await main([
      'node',
      'plandesk',
      'connect',
      '--repo',
      repoDir,
      '--project',
      project.id,
      '--url',
      baseUrl,
      '--token',
      'plandesk_mcp_cli_dispatch_token',
      '--agent',
      'claude',
    ]);

    stdoutSpy.mockRestore();
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toContain('Connected cli-connect');
    expect(existsSync(join(repoDir, '.plandesk', 'config.json'))).toBe(true);
  });
});
