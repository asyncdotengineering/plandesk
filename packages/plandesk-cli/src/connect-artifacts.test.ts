import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLANDESK_SKILL_TEMPLATE_PATH } from './connect-artifacts.js';
import { templatesRoot } from './templates.js';
import {
  appendGitignoreLine,
  buildConfigJson,
  buildConfigJsonV2,
  deleteServerInfo,
  fetchServedDataDir,
  GITIGNORE_SERVER_INFO_LINE,
  GITIGNORE_SYNC_TOKEN_LINE,
  GITIGNORE_TOKEN_LINE,
  insertFactorySentinelBlock,
  insertSentinelBlock,
  isPidAlive,
  isServingExpectedBoard,
  mergeHooksJson,
  mergeMcpJson,
  parseConfigJson,
  readServerInfo,
  readWorkspaceJson,
  removeMcpServerEntry,
  removeSentinelBlock,
  FACTORY_SENTINEL_START,
  FACTORY_SENTINEL_PREAMBLE,
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
  it('builds commit-safe config.json without secrets', () => {
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

  it('builds v2 config.json round-trip', () => {
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

  it('grace-reads v1 config as v1 shape', () => {
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

  it('grace-reads v1 config without version field', () => {
    const v1 = JSON.stringify({
      serverUrl: 'http://127.0.0.1:7526',
      projectId: 'proj-1',
      projectName: 'Legacy',
    });
    const parsed = parseConfigJson(v1);
    expect(parsed.version).toBe('plandesk-connect-v1');
    expect((parsed as { projectId: string }).projectId).toBe('proj-1');
  });

  it('preserves optional sync section without sync token', () => {
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

  it('merges mcp.json with a token-file headersHelper', () => {
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

  it('adopts a bare skill include instead of appending a second block', () => {
    // The live shape: a hand-authored CLAUDE.md carrying the include mid-file
    // with no markers around it. `insertBlock` keys only on the markers, so
    // before this was adopted the include appeared twice after one connect.
    const original = [
      '# CLAUDE.md',
      '',
      'Guidance for this repository.',
      '',
      '@.plandesk/skill.md',
      '',
      '## Something the repo owns',
      '',
      'Tail content.',
      '',
    ].join('\n');

    const next = insertSentinelBlock(original);

    expect(next.match(/@\.plandesk\/skill\.md/g)?.length).toBe(1);
    expect(next.match(new RegExp(SENTINEL_START, 'g'))?.length).toBe(1);
    expect(next.match(new RegExp(SENTINEL_END, 'g'))?.length).toBe(1);

    // Adopted in place: the include keeps the position its author chose, so the
    // repo's own sections stay in order around it.
    expect(next.indexOf('Guidance for this repository.')).toBeLessThan(
      next.indexOf(SENTINEL_START),
    );
    expect(next.indexOf(SENTINEL_END)).toBeLessThan(next.indexOf('## Something the repo owns'));
    expect(next).toContain('Tail content.');

    // And stable across repeated connects.
    expect(insertSentinelBlock(next).match(/@\.plandesk\/skill\.md/g)?.length).toBe(1);
  });

  it('leaves an include already inside the markers alone', () => {
    const content = `# Repo\n\n${buildSentinelBlock()}\n\nTail\n`;
    const next = insertSentinelBlock(content);
    expect(next.match(/@\.plandesk\/skill\.md/g)?.length).toBe(1);
    expect(next.match(new RegExp(SENTINEL_START, 'g'))?.length).toBe(1);
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

    it('round-trips the dataDir field (REQ-A3a)', () => {
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

    it('readServerInfo tolerates an older server.json with no dataDir field', () => {
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

    it('readServerInfo returns undefined when PID is dead', () => {
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

    it('deleteServerInfo removes the file and is idempotent', () => {
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
        expect(await isServingExpectedBoard(`http://127.0.0.1:${String(port)}`, dataDir)).toBe(
          true,
        );
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

  it('ships the conventions skill verbatim from the templates root', () => {
    expect(buildSkillMarkdown()).toBe(
      readFileSync(join(templatesRoot(), PLANDESK_SKILL_TEMPLATE_PATH), 'utf8'),
    );
  });

  /**
   * There must be exactly one copy of the skill. Two copies drift: `factory
   * sync` updates the shipped file on a CLI upgrade and knows nothing about
   * .plandesk/skill.md, so a real file there would leave the CLAUDE.md include
   * serving older text than the skill directory beside it. Keep it a pointer.
   */
  it('keeps .plandesk/skill.md a pointer at the one real copy', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const generated = join(repoRoot, '.plandesk', 'skill.md');
    expect(lstatSync(generated).isSymbolicLink()).toBe(true);
    expect(readFileSync(generated, 'utf8')).toBe(buildSkillMarkdown());
  });

  describe('mergeHooksJson', () => {
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

    const taggedSnippet = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            _plandesk: true,
            matcher: 'startup|resume|compact',
            hooks: [
              {
                type: 'command',
                command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/session-start.sh',
              },
            ],
          },
        ],
        Stop: [
          {
            _plandesk: true,
            hooks: [
              {
                type: 'command',
                command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/checkpoint.sh',
              },
            ],
          },
        ],
        PreCompact: [
          {
            _plandesk: true,
            hooks: [
              {
                type: 'command',
                command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/checkpoint.sh',
              },
            ],
          },
        ],
      },
    });

    it('creates the hooks block when settings.json is absent', () => {
      const merged = mergeHooksJson(undefined, snippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it('merges additively without touching an unrelated event', () => {
      const existing = JSON.stringify({
        hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo other' }] }] },
      });
      const merged = mergeHooksJson(existing, snippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.PostToolUse).toEqual([
        { hooks: [{ type: 'command', command: 'echo other' }] },
      ]);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it('is idempotent — merging the same snippet twice does not duplicate entries', () => {
      const once = mergeHooksJson(undefined, snippet);
      const twice = mergeHooksJson(once, snippet);
      expect(twice).toBe(once);
      const parsed = JSON.parse(twice) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it('keeps a pre-existing entry on the same event alongside the new one', () => {
      const existing = JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
      });
      const merged = mergeHooksJson(existing, snippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(2);
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain('echo mine');
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain('session-start.sh');
    });

    it('two consecutive merges leave exactly one Plan Desk entry per event', () => {
      // Same marker, different path/matcher — the case append-if-absent cannot reclaim.
      const priorSnippet = JSON.stringify({
        hooks: {
          SessionStart: [
            {
              _plandesk: true,
              matcher: 'startup',
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/old-session-start.sh',
                },
              ],
            },
          ],
          Stop: [
            {
              _plandesk: true,
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/old-checkpoint.sh',
                },
              ],
            },
          ],
          PreCompact: [
            {
              _plandesk: true,
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/old-checkpoint.sh',
                },
              ],
            },
          ],
        },
      });
      const once = mergeHooksJson(undefined, priorSnippet);
      const twice = mergeHooksJson(once, taggedSnippet);
      const thrice = mergeHooksJson(twice, taggedSnippet);
      expect(thrice).toBe(twice);
      const parsed = JSON.parse(thrice) as { hooks: Record<string, unknown[]> };
      for (const event of ['SessionStart', 'Stop', 'PreCompact'] as const) {
        const hooks = parsed.hooks[event];
        if (hooks === undefined) {
          throw new Error(`missing ${event} hooks`);
        }
        expect(hooks).toHaveLength(1);
        expect(hooks[0]).toMatchObject({ _plandesk: true });
      }
      expect(JSON.stringify(parsed.hooks)).toContain('session-start.sh');
      expect(JSON.stringify(parsed.hooks)).toContain('checkpoint.sh');
      expect(JSON.stringify(parsed.hooks)).not.toContain('old-session-start.sh');
      expect(JSON.stringify(parsed.hooks)).not.toContain('old-checkpoint.sh');
    });

    it('converges legacy untagged curator entries to the tagged shape without orphans', () => {
      const legacy = JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: 'startup|resume|compact',
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/session-start.sh',
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/checkpoint.sh',
                },
              ],
            },
          ],
          PreCompact: [
            {
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/checkpoint.sh',
                },
              ],
            },
          ],
        },
      });
      const merged = mergeHooksJson(legacy, taggedSnippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      for (const event of ['SessionStart', 'Stop', 'PreCompact'] as const) {
        const hooks = parsed.hooks[event];
        if (hooks === undefined) {
          throw new Error(`missing ${event} hooks`);
        }
        expect(hooks).toHaveLength(1);
        const entry = hooks[0] as { _plandesk?: boolean };
        expect(entry._plandesk).toBe(true);
      }
      // No untagged orphan left: every remaining entry on these events is tagged.
      const serialized = JSON.stringify(parsed.hooks);
      expect((serialized.match(/session-start\.sh/g) ?? []).length).toBe(1);
      expect((serialized.match(/checkpoint\.sh/g) ?? []).length).toBe(2);
    });

    it("preserves a user's own hook inside the same SessionStart array on replace", () => {
      const existing = JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'echo mine' }] },
            {
              _plandesk: true,
              matcher: 'startup',
              hooks: [
                {
                  type: 'command',
                  command: '$CLAUDE_PROJECT_DIR/.agents/curator/hooks/old-session-start.sh',
                },
              ],
            },
          ],
        },
      });
      const merged = mergeHooksJson(existing, taggedSnippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.SessionStart).toHaveLength(2);
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain('echo mine');
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain('session-start.sh');
      expect(JSON.stringify(parsed.hooks.SessionStart)).not.toContain('old-session-start.sh');
      const plandeskEntries = (parsed.hooks.SessionStart ?? []).filter(
        (e) =>
          e !== null &&
          typeof e === 'object' &&
          Object.prototype.hasOwnProperty.call(e, '_plandesk'),
      );
      expect(plandeskEntries).toHaveLength(1);
    });

    it("leaves a user's hooks on events Plan Desk does not use untouched", () => {
      const userOnly = [{ hooks: [{ type: 'command', command: 'echo post-tool' }] }];
      const existing = JSON.stringify({
        hooks: {
          PostToolUse: userOnly,
          Notification: [{ hooks: [{ type: 'command', command: 'echo notify' }] }],
        },
      });
      const merged = mergeHooksJson(existing, taggedSnippet);
      const parsed = JSON.parse(merged) as { hooks: Record<string, unknown[]> };
      expect(parsed.hooks.PostToolUse).toEqual(userOnly);
      expect(parsed.hooks.Notification).toEqual([
        { hooks: [{ type: 'command', command: 'echo notify' }] },
      ]);
      expect(parsed.hooks.SessionStart).toHaveLength(1);
    });
  });
});

describe('insertFactorySentinelBlock', () => {
  const heading = FACTORY_SENTINEL_PREAMBLE.split('\n', 1)[0] ?? '';

  function countOccurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it('adopts a pre-sentinel factory section instead of appending a second copy', () => {
    // Shape observed in a repo scaffolded before the markers existed: the same
    // heading, prose a generation out of date, referencing a file that no longer
    // ships. Appending left an agent reading two contradictory contracts.
    const legacy = [
      '# Repo',
      '',
      '## House rules',
      '',
      'Keep it tidy.',
      '',
      heading,
      '',
      'This repository runs on the Factory workflow. On any work request:',
      '',
      '1. Read [workflow.md](.agents/factory/workflow.md) — a file that no longer ships.',
      '',
      '@.agents/factory/factory.md',
    ].join('\n');

    const result = insertFactorySentinelBlock(legacy);

    expect(countOccurrences(result, heading)).toBe(1);
    expect(countOccurrences(result, FACTORY_SENTINEL_START)).toBe(1);
    expect(result).not.toContain('workflow.md');
    // Content the CLI does not own is untouched.
    expect(result).toContain('## House rules');
    expect(result).toContain('Keep it tidy.');
  });

  it('is idempotent once the block is sentinelled', () => {
    const once = insertFactorySentinelBlock('# Repo\n');
    const twice = insertFactorySentinelBlock(once);
    expect(twice).toBe(once);
    expect(countOccurrences(twice, heading)).toBe(1);
  });

  it('leaves a file with no factory section alone apart from appending', () => {
    const other = '# Repo\n\n## Something else\n\nUnrelated.\n';
    const result = insertFactorySentinelBlock(other);
    expect(result).toContain('## Something else');
    expect(result).toContain('Unrelated.');
    expect(countOccurrences(result, FACTORY_SENTINEL_START)).toBe(1);
  });
});
