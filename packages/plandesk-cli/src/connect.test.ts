import { createServer, type Server } from 'node:http';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { createApp, createEventBus, createServices } from '@plandesk/api';
import {
  createDb,
  createProject,
  createToken,
  migrate,
  revokeToken,
  verifyToken,
  type Db,
} from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { parseConfigJson, SENTINEL_START } from './connect-artifacts.js';
import { formatConnectPrint, runConnect } from './connect.js';
import { runDisconnect } from './disconnect.js';
import { runBindingDoctor } from './binding-doctor.js';
import { main } from './cli.js';

function createTestTokenStore(db: Db) {
  return {
    verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
}

async function withTestServer(
  run: (ctx: { baseUrl: string; db: Db; projectId: string; projectName: string }) => Promise<void>,
): Promise<void> {
  const db = createDb(':memory:');
  migrate(db);
  const project = createProject(db, { name: 'connect-repo' });
  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const mcpApp = createMcpApp({ services, tokenStore: createTestTokenStore(db) });
  const app = createApp({ db, eventBus, services, mcp: mcpApp });

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

  it('writes connect artifacts with env-var mcp config and gitignored token', async () => {
    await withTestServer(async ({ baseUrl, db, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const { token } = createToken(db, { name: 'connect-test' });

      const result = await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token,
        agent: 'both',
        interactive: false,
      });

      expect(result.project.id).toBe(projectId);
      expect(existsSync(join(repoDir, '.plandesk', 'token'))).toBe(true);
      expect(readFileSync(join(repoDir, '.plandesk', 'token'), 'utf8').trim()).toBe(token);
      expect(committedContents(repoDir)).not.toContain('plandesk_mcp_');
      const mcpJson = readFileSync(join(repoDir, '.mcp.json'), 'utf8');
      expect(mcpJson).toContain('headersHelper');
      expect(mcpJson).toContain('.plandesk/token');
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
      const other = createProject(db, { name: 'other-project' });
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

  it('validates binding via doctor', async () => {
    await withTestServer(async ({ baseUrl, db, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const { token } = createToken(db, { name: 'doctor' });
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token,
        interactive: false,
      });

      const report = await runBindingDoctor(repoDir);
      expect(report.present).toBe(true);
      expect(report.serverReachable).toBe(true);
      expect(report.tokenValid).toBe(true);
      expect(report.projectExists).toBe(true);
      expect(report.mcpToolCount).toBeGreaterThan(0);
      expect(report.issues).toEqual([]);
    });
  });

  it('reports token invalid (not valid) when the bound token is revoked', async () => {
    await withTestServer(async ({ baseUrl, db, projectId, projectName }) => {
      const repoDir = makeRepo(projectName);
      const row = createToken(db, { name: 'doctor-revoked' });
      await runConnect({
        repoDir,
        project: projectId,
        url: baseUrl,
        token: row.token,
        interactive: false,
      });
      revokeToken(db, row.id);

      const report = await runBindingDoctor(repoDir);
      expect(report.serverReachable).toBe(true);
      // token-valid must reflect the real authenticated MCP path, not the open
      // REST route — a revoked token 401s live MCP requests, so it is NOT valid.
      expect(report.tokenValid).toBe(false);
      expect(report.mcpToolCount).toBe(0);
      expect(report.issues).toContain('token invalid or revoked');
    });
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
    const db = createDb(':memory:');
    migrate(db);
    const project = createProject(db, { name: 'cli-connect' });
    const eventBus = createEventBus();
    const services = createServices({ db, eventBus });
    const mcpApp = createMcpApp({ services, tokenStore: createTestTokenStore(db) });
    const app = createApp({ db, eventBus, services, mcp: mcpApp });
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
