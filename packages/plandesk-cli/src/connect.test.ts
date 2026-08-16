import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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
import { ensureLocalBetterAuthOrganization } from '@plandesk/api';
import { createMcpApp } from '@plandesk/mcp';
import { writeCliConfig } from './config.js';
import {
  parseConfigJson,
  PLANDESK_CONNECT_VERSION_V2,
  SENTINEL_START,
} from './connect-artifacts.js';
import {
  ConnectError,
  UNCREATED_WORKSPACE_ID,
  formatConnectPrint,
  formatConnectSummary,
  runConnect,
} from './connect.js';
import { buildSkillMarkdown } from './connect-artifacts.js';
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

  /**
   * The pre-3.3.0 shape: .agents/skills/plandesk/SKILL.md is a symlink at
   * .plandesk/skill.md, which holds the real file. Writing the skill without
   * clearing that link first writes through it, and .plandesk/skill.md then
   * becomes a link back — every path reads ELOOP and the CLAUDE.md include
   * resolves to nothing. Shipped broken in 3.3.0.
   */
  it('replaces a pre-3.3.0 skill symlink instead of writing through it', async () => {
    await withTestServer(async ({ baseUrl, projectId }) => {
      const repoDir = makeRepo();
      mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
      mkdirSync(join(repoDir, '.agents', 'skills', 'plandesk'), { recursive: true });
      writeFileSync(join(repoDir, '.plandesk', 'skill.md'), '# old shipped skill\n', 'utf8');
      symlinkSync(
        '../../../.plandesk/skill.md',
        join(repoDir, '.agents', 'skills', 'plandesk', 'SKILL.md'),
      );

      await runConnect({ repoDir, project: projectId, url: baseUrl, interactive: false });

      const source = join(repoDir, '.agents', 'skills', 'plandesk', 'SKILL.md');
      expect(lstatSync(source).isSymbolicLink()).toBe(false);
      expect(readFileSync(source, 'utf8')).toBe(buildSkillMarkdown());

      // Every pointer must still resolve — an ELOOP throws here.
      for (const pointer of ['.plandesk/skill.md', '.claude/skills/plandesk/SKILL.md']) {
        expect(readFileSync(join(repoDir, pointer), 'utf8')).toBe(buildSkillMarkdown());
      }
    });
  });

  it('still binds to a project whose name matches the repo folder', async () => {
    await withTestServer(async ({ baseUrl, db }) => {
      const repoDir = makeRepo();
      const named = await createProject(db, { name: basename(repoDir) });

      const result = await runConnect({
        repoDir,
        url: baseUrl,
        agent: 'both',
        interactive: false,
      });

      expect(result.project?.id).toBe(named.id);
      expect(result.workspace).toBeUndefined();
    });
  });

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

      if (result.project === undefined) {
        throw new Error('missing connected project');
      }
      expect(result.project.id).toBe(projectId);
      expect(existsSync(join(repoDir, '.plandesk', 'token'))).toBe(false);
      expect(committedContents(repoDir)).not.toContain('plandesk_mcp_');
      const mcpJson = readFileSync(join(repoDir, '.mcp.json'), 'utf8');
      expect(mcpJson).toContain('headersHelper');
      expect(readFileSync(join(repoDir, 'CLAUDE.md'), 'utf8')).toContain(SENTINEL_START);
      expect(readFileSync(join(repoDir, '.claude/commands/plandesk.md'), 'utf8')).toContain(
        '@.plandesk/skill.md',
      );
      // Exactly one real copy; every other path points at it. A second copy
      // would go stale the moment `factory sync` updated the shipped skill.
      const source = join(repoDir, '.agents/skills/plandesk/SKILL.md');
      expect(lstatSync(source).isSymbolicLink()).toBe(false);
      expect(readFileSync(source, 'utf8')).toContain('name: plandesk');

      for (const pointer of ['.claude/skills/plandesk/SKILL.md', '.plandesk/skill.md']) {
        const path = join(repoDir, pointer);
        expect(lstatSync(path).isSymbolicLink()).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe(readFileSync(source, 'utf8'));
      }
      const gitignore = readFileSync(join(repoDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.plandesk/token');
      expect(gitignore).toContain('.plandesk/server.json');
      const parsed = parseConfigJson(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8'));
      expect(parsed.version).toBe('plandesk-connect-v1');
      expect((parsed as { projectId: string }).projectId).toBe(projectId);

      const detail = (await fetch(`${baseUrl}/api/v1/projects/${projectId}`).then((r) =>
        r.json(),
      )) as { folder_path: string | null };
      expect(detail.folder_path).toBe(realpathSync(resolve(repoDir)));
    });
  });

  it('warns when an ancestor .mcp.json shadows the one it just wrote', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      // A parent dir with its own .mcp.json — the agent session opens there, so
      // the repo's config is never read.
      const parent = mkdtempSync(join(tmpdir(), 'plandesk-parent-'));
      tempDirs.push(parent);
      writeFileSync(join(parent, '.mcp.json'), '{"mcpServers":{}}', 'utf8');
      const repoDir = join(parent, projectName.replace(/[^a-z0-9-]/gi, '-'));
      mkdirSync(repoDir, { recursive: true });

      const result = await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        agent: 'both',
        interactive: false,
      });

      expect(result.warnings.some((w) => w.includes(join(parent, '.mcp.json')))).toBe(true);
      expect(formatConnectSummary(result)).toContain('takes precedence');
    });
  });

  it('emits no shadow warning when no ancestor .mcp.json exists', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const result = await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        agent: 'both',
        interactive: false,
      });
      expect(result.warnings.filter((w) => w.includes('takes precedence'))).toEqual([]);
    });
  });

  it('removes a stale .plandesk/token on a local rebind (no --token)', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      // Simulate a prior connection to a different server that left a token.
      mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
      writeFileSync(join(repoDir, '.plandesk', 'token'), 'plandesk_mcp_stale_from_old_server\n', 'utf8');

      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        agent: 'both',
        interactive: false,
      });

      // Local loopback needs no token; the stale one must be gone so the MCP
      // does not send an invalid Bearer (401).
      expect(existsSync(join(repoDir, '.plandesk', 'token'))).toBe(false);
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

      if (rebound.project === undefined) {
        throw new Error('missing rebound project');
      }
      expect(rebound.project.id).toBe(other.id);
      const parsed2 = parseConfigJson(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8'));
      expect(parsed2.version).toBe('plandesk-connect-v1');
      expect((parsed2 as { projectId: string }).projectId).toBe(other.id);
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

  it('connect --project does NOT write x-plandesk-workspace-id header', async () => {
    await withTestServer(async ({ baseUrl, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        agent: 'claude',
        interactive: false,
      });

      const mcpRaw = readFileSync(join(repoDir, '.mcp.json'), 'utf8');
      const mcpDoc = JSON.parse(mcpRaw) as {
        mcpServers?: Record<string, { headers?: Record<string, string> }>;
      };
      expect(mcpDoc.mcpServers?.plandesk?.headers).toBeUndefined();
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

    if (result.project === undefined) {
      throw new Error('missing selected project');
    }
    expect(result.project.id).toBe(projectA.id);
    expect(result.serverUrl).toBe(baseUrl.replace(/\/$/, ''));
    expect(result.tokenCreated).toBe(true);

    const writtenToken = readFileSync(join(repoDir, '.plandesk', 'token'), 'utf8').trim();
    // Must be the scoped agent key — never the owner key from login config.
    expect(writtenToken).not.toBe(ownerKey.key);
    expect(writtenToken.length).toBeGreaterThan(0);

    const bound = parseConfigJson(readFileSync(join(repoDir, '.plandesk/config.json'), 'utf8'));
    expect(bound.version).toBe('plandesk-connect-v1');
    expect((bound as { projectId: string }).projectId).toBe(projectA.id);
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

  it('connect --workspace locally writes v2 config with workspace binding and no token', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const org = { id: DEFAULT_ORG_ID, name: 'Local Org' };
    const project = await createProjectInOrg(db, {
      name: 'ws-project',
      orgId: org.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });

    const auth = createBetterAuth({
      client: db.$client,
      secret: HOSTED_SECRET,
      baseURL: 'http://127.0.0.1',
      github: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);

    const services = createServices({ db, orgId: project.orgId });
    const mcpApp = createMcpApp({ services });
    const app = createApp({
      db,
      services,
      mcp: mcpApp,
      betterAuth: { secret: HOSTED_SECRET, baseURL: 'http://127.0.0.1' },
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

    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-ws-connect-'));
    tempDirs.push(repoDir);
    writeFileSync(join(repoDir, 'README.md'), '# ws-project\n', 'utf8');

    const result = await runConnect({
      repoDir,
      workspace: 'General',
      url: baseUrl,
      agent: 'claude',
      interactive: false,
    });

    if (result.workspace === undefined) {
      throw new Error('missing selected workspace');
    }
    expect(result.workspace.name).toBe('General');
    expect(result.tokenCreated).toBe(false);
    expect(existsSync(join(repoDir, '.plandesk', 'token'))).toBe(false);

    const configRaw = readFileSync(join(repoDir, '.plandesk', 'config.json'), 'utf8');
    const config = parseConfigJson(configRaw);
    expect(config.version).toBe(PLANDESK_CONNECT_VERSION_V2);
    expect((config as { workspaceId: string }).workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect((config as { workspaceName: string }).workspaceName).toBe('General');
    expect((config as { orgId: string }).orgId).toBe(DEFAULT_ORG_ID);
    expect((config as { projectIds: string[] }).projectIds).toContain(project.id);

    // MCP config carries the workspace header for local loopback scoping
    const mcpRaw = readFileSync(join(repoDir, '.mcp.json'), 'utf8');
    const mcpDoc = JSON.parse(mcpRaw) as {
      mcpServers?: Record<string, { headers?: Record<string, string> }>;
    };
    expect(mcpDoc.mcpServers?.plandesk?.headers?.['x-plandesk-workspace-id']).toBe(
      DEFAULT_WORKSPACE_ID,
    );
  });

  async function startWorkspaceServer(): Promise<string> {
    const db = await createDb(':memory:');
    await migrate(db);
    await createProjectInOrg(db, {
      name: 'unrelated-project',
      orgId: DEFAULT_ORG_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });

    const auth = createBetterAuth({
      client: db.$client,
      secret: HOSTED_SECRET,
      baseURL: 'http://127.0.0.1',
      github: { clientId: 'test-client', clientSecret: 'test-secret' },
    });
    if (auth === undefined) throw new Error('expected better-auth');
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);

    const services = createServices({ db, orgId: DEFAULT_ORG_ID });
    const app = createApp({
      db,
      services,
      mcp: createMcpApp({ services }),
      betterAuth: { secret: HOSTED_SECRET, baseURL: 'http://127.0.0.1' },
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
    return `http://127.0.0.1:${String(address.port)}`;
  }

  function makeUnboundRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-auto-ws-'));
    tempDirs.push(repoDir);
    writeFileSync(join(repoDir, 'README.md'), '# new repo\n', 'utf8');
    return repoDir;
  }

  it('gives an unbound repo its own workspace named after the folder', async () => {
    const baseUrl = await startWorkspaceServer();
    const repoDir = makeUnboundRepo();

    const result = await runConnect({ repoDir, url: baseUrl, agent: 'claude', interactive: false });

    expect(result.workspace?.name).toBe(basename(repoDir));
    expect(result.project).toBeUndefined();

    const config = parseConfigJson(readFileSync(join(repoDir, '.plandesk', 'config.json'), 'utf8'));
    expect(config.version).toBe(PLANDESK_CONNECT_VERSION_V2);
    expect((config as { workspaceName: string }).workspaceName).toBe(basename(repoDir));

    const mcpDoc = JSON.parse(readFileSync(join(repoDir, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, { headers?: Record<string, string> }>;
    };
    expect(mcpDoc.mcpServers?.plandesk?.headers?.['x-plandesk-workspace-id']).toBe(
      (config as { workspaceId: string }).workspaceId,
    );
  });

  it('--print previews the new workspace without creating it', async () => {
    const baseUrl = await startWorkspaceServer();
    const repoDir = makeUnboundRepo();

    const result = await runConnect({
      repoDir,
      url: baseUrl,
      agent: 'claude',
      interactive: false,
      print: true,
    });

    expect(result.workspace?.name).toBe(basename(repoDir));
    expect(result.workspace?.id).toBe(UNCREATED_WORKSPACE_ID);
    expect(existsSync(join(repoDir, '.plandesk', 'config.json'))).toBe(false);

    const listed = (await fetch(`${baseUrl}/api/v1/orgs/${DEFAULT_ORG_ID}/workspaces`).then((r) =>
      r.json(),
    )) as { workspaces: { name: string }[] };
    expect(listed.workspaces.some((w) => w.name === basename(repoDir))).toBe(false);
  });

  it('reuses a same-named workspace instead of forking a duplicate on reconnect', async () => {
    const baseUrl = await startWorkspaceServer();
    const repoDir = makeUnboundRepo();

    const first = await runConnect({ repoDir, url: baseUrl, agent: 'claude', interactive: false });
    rmSync(join(repoDir, '.plandesk', 'config.json'), { force: true });
    const second = await runConnect({ repoDir, url: baseUrl, agent: 'claude', interactive: false });

    expect(second.workspace?.id).toBe(first.workspace?.id);

    const listed = (await fetch(`${baseUrl}/api/v1/orgs/${DEFAULT_ORG_ID}/workspaces`).then((r) =>
      r.json(),
    )) as { workspaces: { name: string }[] };
    expect(listed.workspaces.filter((w) => w.name === basename(repoDir))).toHaveLength(1);
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
