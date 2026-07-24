import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';
import {
  appendGitignoreLine,
  buildConfigJson,
  buildConfigJsonV2,
  deleteServerInfo,
  fetchServedDataDir,
  GITIGNORE_SERVER_INFO_LINE,
  GITIGNORE_SYNC_TOKEN_LINE,
  GITIGNORE_TOKEN_LINE,
  insertSentinelBlock,
  isPidAlive,
  isServingExpectedBoard,
  mergeCuratorHooksJson,
  mergeMcpJson,
  parseConfigJson,
  readServerInfo,
  readWorkspaceJson,
  removeMcpServerEntry,
  removeSentinelBlock,
  SENTINEL_END,
  SENTINEL_START,
  TOKEN_ENV_VAR,
  writeServerInfo,
  writeWorkspaceJson,
  WORKSPACE_JSON_VERSION,
  buildHeadersHelper,
  buildMcpServerEntry,
  buildSentinelBlock,
  buildSkillMarkdown,
} from './connect-artifacts.js';
import { runInit } from './init.js';
import { startServer } from './serve.js';

describe('connect artifacts', () => {
  it('builds commit-safe config.json without secrets', async () => {
    const json = buildConfigJson({
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
    });
    expect(json).not.toContain('plandesk_mcp_');
    expect(parseConfigJson(json)).toEqual({
      version: 'plandesk-connect-v1',
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
    });
  });

  it('builds v2 config.json round-trip', async () => {
    const json = buildConfigJsonV2({
      serverUrl: 'http://127.0.0.1:7526',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      workspaceName: 'Engineering',
      projectIds: ['proj-1', 'proj-2'],
    });
    expect(json).not.toContain('plandesk_mcp_');
    const parsed = parseConfigJson(json);
    expect(parsed).toEqual({
      version: 'plandesk-connect-v2',
      serverUrl: 'http://127.0.0.1:7526',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      workspaceName: 'Engineering',
      projectIds: ['proj-1', 'proj-2'],
    });
  });

  it('grace-reads v1 config as v1 shape', async () => {
    const v1 = JSON.stringify({
      version: 'plandesk-connect-v1',
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Legacy',
    });
    const parsed = parseConfigJson(v1);
    expect(parsed.version).toBe('plandesk-connect-v1');
    expect((parsed as { projectId: string }).projectId).toBe('proj-1');
  });

  it('grace-reads v1 config without version field', async () => {
    const v1 = JSON.stringify({
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Legacy',
    });
    const parsed = parseConfigJson(v1);
    expect(parsed.version).toBe('plandesk-connect-v1');
    expect((parsed as { projectId: string }).projectId).toBe('proj-1');
  });

  it('preserves optional sync section without sync token', async () => {
    const json = buildConfigJson({
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
      sync: {
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-123',
      },
    });
    expect(json).not.toContain('plandesk_sync_');
    expect(parseConfigJson(json)).toEqual({
      version: 'plandesk-connect-v1',
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
      sync: {
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-123',
      },
    });
  });

  it('merges mcp.json with a token-file headersHelper', async () => {
    const existing = JSON.stringify({
      mcpServers: {
        other: { type: 'http', url: 'http://example.test/mcp/' },
      },
    });
    const merged = mergeMcpJson(existing, 'http://127.0.0.1:7526');
    expect(merged).not.toContain('plandesk_mcp_');
    const parsed = JSON.parse(merged) as {
      mcpServers: Record<
        string,
        { url: string; headers?: Record<string, string>; headersHelper?: string }
      >;
    };
    expect(parsed.mcpServers.plandesk?.url).toBe('http://127.0.0.1:7526/mcp/');
    expect(parsed.mcpServers.other?.url).toBe('http://example.test/mcp/');
    const entry = buildMcpServerEntry('http://127.0.0.1:7526/');
    expect(entry.headers).toBeUndefined();
    expect(entry.headersHelper).toContain('.plandesk/token');
    expect(entry.headersHelper).toContain(`\${${TOKEN_ENV_VAR}:-`);
  });

  it('headersHelper resolves the token from a parent directory and honors the env override', async () => {
    const helper = buildHeadersHelper();
    const repoDir = mkdtempSync(join(tmpdir(), 'plandesk-helper-'));
    try {
      mkdirSync(join(repoDir, '.plandesk'), { recursive: true });
      mkdirSync(join(repoDir, 'nested', 'deep'), { recursive: true });
      writeFileSync(join(repoDir, '.plandesk', 'token'), 'plandesk_mcp_helper_token\n', 'utf8');
      const fromFile = execFileSync('sh', ['-c', helper], {
        cwd: join(repoDir, 'nested', 'deep'),
        encoding: 'utf8',
        env: { ...process.env, [TOKEN_ENV_VAR]: '' },
      });
      expect(JSON.parse(fromFile)).toEqual({
        Authorization: 'Bearer plandesk_mcp_helper_token',
      });
      const fromEnv = execFileSync('sh', ['-c', helper], {
        cwd: join(repoDir, 'nested', 'deep'),
        encoding: 'utf8',
        env: { ...process.env, [TOKEN_ENV_VAR]: 'override-token' },
      });
      expect(JSON.parse(fromEnv)).toEqual({ Authorization: 'Bearer override-token' });
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('removes only the plandesk mcp entry', async () => {
    const existing = JSON.stringify({
      mcpServers: {
        plandesk: buildMcpServerEntry('http://127.0.0.1:7526'),
        other: { type: 'http', url: 'http://example.test/mcp/' },
      },
    });
    const next = removeMcpServerEntry(existing);
    expect(next).toBeDefined();
    const parsed = JSON.parse(next ?? '') as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers.plandesk).toBeUndefined();
    expect(parsed.mcpServers.other).toBeDefined();
    expect(
      removeMcpServerEntry(JSON.stringify({ mcpServers: { plandesk: buildMcpServerEntry('x') } })),
    ).toBeUndefined();
  });

  it('inserts and replaces sentinel blocks idempotently', async () => {
    const original = '# Repo\n\nSome notes.\n';
    const first = insertSentinelBlock(original);
    expect(first).toContain(SENTINEL_START);
    expect(first).toContain('@.plandesk/skill.md');
    expect(first).toContain(SENTINEL_END);
    expect(first).toContain('# Repo');
    const second = insertSentinelBlock(first);
    expect(second.match(new RegExp(SENTINEL_START, 'g'))?.length).toBe(1);
    expect(second.match(new RegExp(SENTINEL_END, 'g'))?.length).toBe(1);
  });

  it('removes sentinel blocks without touching surrounding content', async () => {
    const content = `# Title\n\n${buildSentinelBlock()}\n\nTail content\n`;
    const next = removeSentinelBlock(content);
    expect(next?.trimEnd()).toBe('# Title\n\nTail content');
  });

  it('appends gitignore line only once', async () => {
    expect(appendGitignoreLine(undefined, GITIGNORE_TOKEN_LINE)).toBe('.plandesk/token\n');
    const once = appendGitignoreLine('node_modules/\n', GITIGNORE_TOKEN_LINE);
    const twice = appendGitignoreLine(once, GITIGNORE_TOKEN_LINE);
    expect(twice).toBe(once);
    expect(twice.split('\n').filter((line) => line === GITIGNORE_TOKEN_LINE).length).toBe(1);
    const withSync = appendGitignoreLine(once, GITIGNORE_SYNC_TOKEN_LINE);
    expect(withSync).toContain(GITIGNORE_SYNC_TOKEN_LINE);
    expect(appendGitignoreLine(withSync, GITIGNORE_SYNC_TOKEN_LINE)).toBe(withSync);
    const withServerInfo = appendGitignoreLine(once, GITIGNORE_SERVER_INFO_LINE);
    expect(withServerInfo).toContain(GITIGNORE_SERVER_INFO_LINE);
    expect(appendGitignoreLine(withServerInfo, GITIGNORE_SERVER_INFO_LINE)).toBe(withServerInfo);
  });

  describe('workspace.json helpers', () => {
    it('round-trips write and read', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-ws-'));
      try {
        expect(readWorkspaceJson(dir)).toBeUndefined();
        writeWorkspaceJson(dir, 3401);
        const ws = readWorkspaceJson(dir);
        expect(ws).toEqual({ version: WORKSPACE_JSON_VERSION, port: 3401 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns undefined for missing or malformed file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-ws-bad-'));
      try {
        writeFileSync(join(dir, 'workspace.json'), '{"version":"old","port":3401}', 'utf8');
        expect(readWorkspaceJson(dir)).toBeUndefined();
        writeFileSync(join(dir, 'workspace.json'), 'not json', 'utf8');
        expect(readWorkspaceJson(dir)).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('server.json helpers', () => {
    it('isPidAlive returns true for own PID and false for a dead PID', async () => {
      expect(isPidAlive(process.pid)).toBe(true);
      expect(isPidAlive(999999999)).toBe(false);
    });

    it('round-trips writeServerInfo and readServerInfo with a live PID', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-'));
      try {
        expect(readServerInfo(dir)).toBeUndefined();
        writeServerInfo(dir, {
          port: 3401,
          pid: process.pid,
          host: '0.0.0.0',
          startedAt: '2026-01-01T00:00:00.000Z',
        });
        const info = readServerInfo(dir);
        expect(info?.port).toBe(3401);
        expect(info?.pid).toBe(process.pid);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('round-trips the dataDir field (REQ-A3a)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-datadir-'));
      try {
        writeServerInfo(dir, {
          port: 3401,
          pid: process.pid,
          host: '0.0.0.0',
          startedAt: '2026-01-01T00:00:00.000Z',
          dataDir: dir,
        });
        expect(readServerInfo(dir)?.dataDir).toBe(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('readServerInfo tolerates an older server.json with no dataDir field', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-legacy-'));
      try {
        writeFileSync(
          join(dir, 'server.json'),
          JSON.stringify({
            port: 3401,
            pid: process.pid,
            host: '0.0.0.0',
            startedAt: '2026-01-01T00:00:00.000Z',
          }),
          'utf8',
        );
        const info = readServerInfo(dir);
        expect(info?.port).toBe(3401);
        expect(info?.dataDir).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('readServerInfo returns undefined when PID is dead', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-dead-'));
      try {
        writeServerInfo(dir, {
          port: 3401,
          pid: 999999999,
          host: '0.0.0.0',
          startedAt: '2026-01-01T00:00:00.000Z',
        });
        expect(readServerInfo(dir)).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('deleteServerInfo removes the file and is idempotent', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-del-'));
      try {
        writeServerInfo(dir, {
          port: 3401,
          pid: process.pid,
          host: '0.0.0.0',
          startedAt: '2026-01-01T00:00:00.000Z',
        });
        expect(readServerInfo(dir)).toBeDefined();
        deleteServerInfo(dir);
        expect(readServerInfo(dir)).toBeUndefined();
        expect(() => {
          deleteServerInfo(dir);
        }).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('served board identity (REQ-A3b)', () => {
    const servers: Array<{ close: (cb?: (err?: Error) => void) => void }> = [];

    async function closeAll(): Promise<void> {
      await Promise.all(
        servers.splice(0).map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => {
                resolve();
              });
            }),
        ),
      );
    }

    it('fetchServedDataDir reads the board a live server actually serves', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'plandesk-identity-'));
      try {
        await runInit(dataDir);
        const server = await startServer({ port: 0, dataDir });
        servers.push(server);
        if (!server.listening) {
          await new Promise<void>((resolve) => server.once('listening', resolve));
        }
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;

        expect(await fetchServedDataDir(`http://127.0.0.1:${String(port)}`)).toBe(dataDir);
        expect(await isServingExpectedBoard(`http://127.0.0.1:${String(port)}`, dataDir)).toBe(true);
        expect(
          await isServingExpectedBoard(`http://127.0.0.1:${String(port)}`, '/some/other/board'),
        ).toBe(false);
      } finally {
        await closeAll();
        rmSync(dataDir, { recursive: true, force: true });
      }
    });

    it('fetchServedDataDir returns undefined when nothing is listening', async () => {
      expect(await fetchServedDataDir('http://127.0.0.1:1')).toBeUndefined();
    });
  });

  it('ships RFC skill template verbatim', async () => {
    expect(buildSkillMarkdown()).toBe(`${PLANDESK_SKILL_TEMPLATE}\n`);
  });

  describe('mergeCuratorHooksJson', () => {
    const snippet = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|resume|compact',
            hooks: [{ type: 'command', command: '.agents/curator/hooks/session-start.sh' }],
          },
        ],
        Stop: [{ hooks: [{ type: 'command', command: '.agents/curator/hooks/checkpoint.sh' }] }],
      },
    });

    it('creates the hooks block when settings.json is absent', async () => {
      const merged = mergeCuratorHooksJson(undefined, snippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it('merges additively without touching an unrelated event', async () => {
      const existing = JSON.stringify({
        hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo other' }] }] },
      });
      const merged = mergeCuratorHooksJson(existing, snippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.PostToolUse).toEqual([
        { hooks: [{ type: 'command', command: 'echo other' }] },
      ]);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it('is idempotent — merging the same snippet twice does not duplicate entries', async () => {
      const once = mergeCuratorHooksJson(undefined, snippet);
      const twice = mergeCuratorHooksJson(once, snippet);
      expect(twice).toBe(once);
      const parsed = JSON.parse(twice) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it('keeps a pre-existing entry on the same event alongside the new one', async () => {
      const existing = JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
      });
      const merged = mergeCuratorHooksJson(existing, snippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(2);
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain('echo mine');
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain('session-start.sh');
    });
  });
});
