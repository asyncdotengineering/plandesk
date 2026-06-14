import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';
import {
  appendGitignoreLine,
  buildConfigJson,
  buildHeadersHelper,
  buildMcpServerEntry,
  buildSentinelBlock,
  buildSkillMarkdown,
  deleteServerInfo,
  GITIGNORE_SERVER_INFO_LINE,
  GITIGNORE_SYNC_TOKEN_LINE,
  GITIGNORE_TOKEN_LINE,
  insertSentinelBlock,
  isPidAlive,
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
} from './connect-artifacts.js';

describe('connect artifacts', () => {
  it('builds commit-safe config.json without secrets', () => {
    const json = buildConfigJson({
      serverUrl: 'http://127.0.0.1:3847',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
    });
    expect(json).not.toContain('plandesk_mcp_');
    expect(parseConfigJson(json)).toEqual({
      version: 'plandesk-connect-v1',
      serverUrl: 'http://127.0.0.1:3847',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
    });
  });

  it('preserves optional sync section without sync token', () => {
    const json = buildConfigJson({
      serverUrl: 'http://127.0.0.1:3847',
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
      serverUrl: 'http://127.0.0.1:3847',
      projectId: 'proj-1',
      projectName: 'Checkout Revamp',
      sync: {
        serverUrl: 'https://sync.example',
        globalProjectId: 'gid-123',
      },
    });
  });

  it('merges mcp.json with a token-file headersHelper', () => {
    const existing = JSON.stringify({
      mcpServers: {
        other: { type: 'http', url: 'http://example.test/mcp/' },
      },
    });
    const merged = mergeMcpJson(existing, 'http://127.0.0.1:3847');
    expect(merged).not.toContain('plandesk_mcp_');
    const parsed = JSON.parse(merged) as {
      mcpServers: Record<string, { url: string; headers?: Record<string, string>; headersHelper?: string }>;
    };
    expect(parsed.mcpServers.plandesk?.url).toBe('http://127.0.0.1:3847/mcp/');
    expect(parsed.mcpServers.other?.url).toBe('http://example.test/mcp/');
    const entry = buildMcpServerEntry('http://127.0.0.1:3847/');
    expect(entry.headers).toBeUndefined();
    expect(entry.headersHelper).toContain('.plandesk/token');
    expect(entry.headersHelper).toContain(`\${${TOKEN_ENV_VAR}:-`);
  });

  it('headersHelper resolves the token from a parent directory and honors the env override', () => {
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

  it('removes only the plandesk mcp entry', () => {
    const existing = JSON.stringify({
      mcpServers: {
        plandesk: buildMcpServerEntry('http://127.0.0.1:3847'),
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

  it('inserts and replaces sentinel blocks idempotently', () => {
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

  it('removes sentinel blocks without touching surrounding content', () => {
    const content = `# Title\n\n${buildSentinelBlock()}\n\nTail content\n`;
    const next = removeSentinelBlock(content);
    expect(next?.trimEnd()).toBe('# Title\n\nTail content');
  });

  it('appends gitignore line only once', () => {
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
    it('round-trips write and read', () => {
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

    it('returns undefined for missing or malformed file', () => {
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
    it('isPidAlive returns true for own PID and false for a dead PID', () => {
      expect(isPidAlive(process.pid)).toBe(true);
      expect(isPidAlive(999999999)).toBe(false);
    });

    it('round-trips writeServerInfo and readServerInfo with a live PID', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-'));
      try {
        expect(readServerInfo(dir)).toBeUndefined();
        writeServerInfo(dir, { port: 3401, pid: process.pid, host: '0.0.0.0', startedAt: '2026-01-01T00:00:00.000Z' });
        const info = readServerInfo(dir);
        expect(info?.port).toBe(3401);
        expect(info?.pid).toBe(process.pid);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('readServerInfo returns undefined when PID is dead', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-dead-'));
      try {
        writeServerInfo(dir, { port: 3401, pid: 999999999, host: '0.0.0.0', startedAt: '2026-01-01T00:00:00.000Z' });
        expect(readServerInfo(dir)).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('deleteServerInfo removes the file and is idempotent', () => {
      const dir = mkdtempSync(join(tmpdir(), 'plandesk-srv-del-'));
      try {
        writeServerInfo(dir, { port: 3401, pid: process.pid, host: '0.0.0.0', startedAt: '2026-01-01T00:00:00.000Z' });
        expect(readServerInfo(dir)).toBeDefined();
        deleteServerInfo(dir);
        expect(readServerInfo(dir)).toBeUndefined();
        expect(() => deleteServerInfo(dir)).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('ships RFC skill template verbatim', () => {
    expect(buildSkillMarkdown()).toBe(`${PLANDESK_SKILL_TEMPLATE}\n`);
  });
});
