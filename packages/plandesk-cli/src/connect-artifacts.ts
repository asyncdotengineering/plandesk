import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';

export const PLANDESK_CONNECT_VERSION = 'plandesk-connect-v1';
export const SENTINEL_START = '<!-- plandesk:start -->';
export const SENTINEL_END = '<!-- plandesk:end -->';
export const SENTINEL_INCLUDE = '@.plandesk/skill.md';
export const TOKEN_ENV_VAR = 'PLANDESK_MCP_TOKEN';
export const SYNC_TOKEN_ENV_VAR = 'PLANDESK_SYNC_TOKEN';
export const GITIGNORE_TOKEN_LINE = '.plandesk/token';
export const GITIGNORE_SYNC_TOKEN_LINE = '.plandesk/sync-token';
export const MCP_SERVER_KEY = 'plandesk';

export type PlanDeskSyncConfig = {
  serverUrl: string;
  globalProjectId: string;
};

export type PlanDeskConfig = {
  version: typeof PLANDESK_CONNECT_VERSION;
  serverUrl: string;
  projectId: string;
  projectName: string;
  /** Hosted org after promote (`plandesk push --to`). Optional for older configs. */
  orgId?: string;
  sync?: PlanDeskSyncConfig;
};

export type McpJson = {
  mcpServers?: Record<
    string,
    {
      type: string;
      url: string;
      headers?: Record<string, string>;
      headersHelper?: string;
    }
  >;
};

export const SKILL_DIRS = ['.claude/skills/plandesk', '.agents/skills/plandesk'] as const;
export const SKILL_SYMLINK_TARGET = '../../../.plandesk/skill.md';

export function buildSentinelBlock(): string {
  return `${SENTINEL_START}\n${SENTINEL_INCLUDE}\n${SENTINEL_END}`;
}

// Global agent-config directories: writing repo artifacts (CLAUDE.md includes,
// .mcp.json, skills) directly into one of these leaks into every project on
// the machine — e.g. ~/.claude/CLAUDE.md is Claude Code's *global* instructions.
export const GLOBAL_CONFIG_DIR_NAMES = [
  '.claude',
  '.codex',
  '.agents',
  '.config',
  '.plandesk',
] as const;

export function globalDirRefusalReason(repoDir: string, home = homedir()): string | undefined {
  const resolved = resolve(repoDir);
  const resolvedHome = resolve(home);
  if (resolved === resolvedHome) {
    return 'your home directory';
  }
  for (const name of GLOBAL_CONFIG_DIR_NAMES) {
    if (resolved === join(resolvedHome, name)) {
      return `the global ${name} directory`;
    }
  }
  return undefined;
}

export function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function buildMcpUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/mcp/`;
}

export function buildConfigJson(input: {
  serverUrl: string;
  projectId: string;
  projectName: string;
  orgId?: string;
  sync?: PlanDeskSyncConfig;
}): string {
  const config: PlanDeskConfig = {
    version: PLANDESK_CONNECT_VERSION,
    serverUrl: normalizeServerUrl(input.serverUrl),
    projectId: input.projectId,
    projectName: input.projectName,
  };
  if (input.orgId !== undefined && input.orgId.trim() !== '') {
    config.orgId = input.orgId;
  }
  if (input.sync !== undefined) {
    config.sync = {
      serverUrl: normalizeServerUrl(input.sync.serverUrl),
      globalProjectId: input.sync.globalProjectId,
    };
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

// --- binding resolution — shared by binding-doctor, context, and progress-checkpoint ---

export type PlanDeskBinding = {
  config: PlanDeskConfig;
  /** Present for hosted agent keys; absent for local loopback (owner without token). */
  token?: string;
};

export function readPlandeskConfig(repoDir: string): PlanDeskConfig | undefined {
  const configPath = join(repoDir, '.plandesk', 'config.json');
  if (!existsSync(configPath)) {
    return undefined;
  }
  return parseConfigJson(readFileSync(configPath, 'utf8'));
}

export function readPlandeskToken(repoDir: string): string | undefined {
  const tokenPath = join(repoDir, '.plandesk', 'token');
  if (!existsSync(tokenPath)) {
    return undefined;
  }
  const token = readFileSync(tokenPath, 'utf8').trim();
  return token === '' ? undefined : token;
}

// Resolves a repo's Plan Desk binding for commands that talk to the server over
// HTTP. Config alone is enough for local loopback (no token file). Hosted
// connects still write a scoped agent key. Callers treat missing binding as an
// idle no-op, never an error.
export function resolvePlandeskBinding(repoDir: string): PlanDeskBinding | undefined {
  const config = readPlandeskConfig(repoDir);
  if (!config) {
    return undefined;
  }
  const token = readPlandeskToken(repoDir);
  return token === undefined ? { config } : { config, token };
}

function parseSyncConfig(raw: unknown): PlanDeskSyncConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw new Error('invalid config.json sync section');
  }
  const sync = raw as Partial<PlanDeskSyncConfig>;
  if (typeof sync.serverUrl !== 'string' || typeof sync.globalProjectId !== 'string') {
    throw new Error('invalid config.json sync section');
  }
  return {
    serverUrl: normalizeServerUrl(sync.serverUrl),
    globalProjectId: sync.globalProjectId,
  };
}

export function parseConfigJson(content: string): PlanDeskConfig {
  const parsed = JSON.parse(content) as Partial<PlanDeskConfig>;
  if (parsed.version !== PLANDESK_CONNECT_VERSION) {
    throw new Error(`unsupported config version: ${String(parsed.version)}`);
  }
  if (
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.projectId !== 'string' ||
    typeof parsed.projectName !== 'string'
  ) {
    throw new Error('invalid config.json shape');
  }
  const config: PlanDeskConfig = {
    version: PLANDESK_CONNECT_VERSION,
    serverUrl: normalizeServerUrl(parsed.serverUrl),
    projectId: parsed.projectId,
    projectName: parsed.projectName,
  };
  if (typeof parsed.orgId === 'string' && parsed.orgId.trim() !== '') {
    config.orgId = parsed.orgId.trim();
  }
  const sync = parseSyncConfig(parsed.sync);
  if (sync !== undefined) {
    config.sync = sync;
  }
  return config;
}

// Resolves the token at connection time with zero user setup: prefer the
// env var override, else walk up from $PWD to the repo's .plandesk/token
// (the helper's cwd is wherever the agent was launched, not the repo root).
export function buildHeadersHelper(): string {
  return (
    'd="$PWD"; while [ "$d" != "/" ] && [ ! -f "$d/.plandesk/token" ]; do d="${d%/*}"; [ -n "$d" ] || d="/"; done; ' +
    `printf '{"Authorization":"Bearer %s"}' "\${${TOKEN_ENV_VAR}:-$(cat "$d/.plandesk/token" 2>/dev/null)}"`
  );
}

export function buildMcpServerEntry(serverUrl: string): NonNullable<McpJson['mcpServers']>[string] {
  return {
    type: 'http',
    url: buildMcpUrl(serverUrl),
    headersHelper: buildHeadersHelper(),
  };
}

export function mergeMcpJson(existingContent: string | undefined, serverUrl: string): string {
  let doc: McpJson = {};
  if (existingContent !== undefined && existingContent.trim() !== '') {
    doc = JSON.parse(existingContent) as McpJson;
  }
  const servers = doc.mcpServers ?? {};
  servers[MCP_SERVER_KEY] = buildMcpServerEntry(serverUrl);
  doc.mcpServers = servers;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Curator hooks (F1): a `.claude/settings.json` `hooks` block, additively
// merged from the project-local snippet. Never clobbers a user's existing
// hooks for OTHER events, and never duplicates the curator entries on rerun —
// each event's array keeps at most one copy of each snippet entry.
export type SettingsJson = {
  hooks?: Record<string, unknown[]>;
};

// Key order must not affect equality here — a linter, formatter, or hand
// edit reordering an entry's keys is still the same entry, and must still be
// recognized as a duplicate on rerun.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function mergeCuratorHooksJson(
  existingContent: string | undefined,
  snippetContent: string,
): string {
  const snippet = JSON.parse(snippetContent) as SettingsJson;
  let doc: SettingsJson = {};
  if (existingContent !== undefined && existingContent.trim() !== '') {
    doc = JSON.parse(existingContent) as SettingsJson;
  }
  const hooks = doc.hooks ?? {};
  for (const [event, snippetEntries] of Object.entries(snippet.hooks ?? {})) {
    const existingEntries = hooks[event] ?? [];
    const merged = [...existingEntries];
    for (const entry of snippetEntries) {
      const entryCanonical = canonicalJson(entry);
      if (!merged.some((candidate) => canonicalJson(candidate) === entryCanonical)) {
        merged.push(entry);
      }
    }
    hooks[event] = merged;
  }
  doc.hooks = hooks;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function removeMcpServerEntry(existingContent: string): string | undefined {
  const doc = JSON.parse(existingContent) as McpJson;
  if (doc.mcpServers === undefined) {
    return existingContent;
  }
  const rest = Object.fromEntries(
    Object.entries(doc.mcpServers).filter(([key]) => key !== MCP_SERVER_KEY),
  );
  if (Object.keys(rest).length === 0) {
    return undefined;
  }
  doc.mcpServers = rest;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Always-on context is the minimum behavioral gate plus the tool conventions the
// agent cannot guess — everything else lives on disk, path-referenced, pulled on
// demand. So the sentinel rides the crisp PREAMBLE (the gate) plus exactly one
// @-include: factory.md, the per-work-item contract whose absence would actually
// change behavior. The session program (workflow.md) and the execution posture
// (autonomous-stand.md) are named by path in the preamble and read when needed —
// inlining ~230 more lines every session is noise a capable agent skims past.
// Dispatch DATA (protocol, workers, lanes, verifiers) stays on-demand too.
export const FACTORY_SENTINEL_START = '<!-- plandesk-factory:start -->';
export const FACTORY_SENTINEL_END = '<!-- plandesk-factory:end -->';
export const FACTORY_SENTINEL_INCLUDES = ['@.agents/factory/factory.md'];

// Always-on directive prose inserted into CLAUDE.md / AGENTS.md. This preamble is
// the behavioral gate; the single @-include above pulls the per-item contract.
// The other policy docs are referenced by path here, not inlined.
export const FACTORY_SENTINEL_PREAMBLE = `## Plan Desk Factory — default operating mode

This repository runs on the Factory workflow. On any work request:
1. **Follow the factory cycle** — the always-on [factory.md](.agents/factory/factory.md) contract governs each work item: pull → read → red gate → act → prove → observe → gate → report. For the session program (orient → intake → execute → finish), read [workflow.md](.agents/factory/workflow.md).
2. **Delegate implementation by default — when a worker is available.** The supervisor orchestrates; IC workers execute. Probe the dispatchers in [.agents/factory/workers/](.agents/factory/workers/) per [protocol.md](.agents/factory/protocol.md) and hand each work item to a probed worker. **If no worker is installed on this machine, do the work yourself under the same contract** — never skip the cycle just because you are the one typing, and never assume a delegation skill or worker CLI exists that this repo did not ship. Write inline without dispatch only for trivial edits, integration/conflict resolution, and review fixes under ~5 lines.
3. **Operate in autonomous-stand mode** — decompose the goal into verifiable moves on a harness task list (\`TaskCreate\` / \`TaskList\` / \`TaskUpdate\`), drive them to zero, and ship without pausing for permission. The full posture is [autonomous-stand.md](.agents/factory/autonomous-stand.md).
4. **Prove before done** — re-run the claimed checks per [protocol.md](.agents/factory/protocol.md); exit codes are authoritative.

New to this repo? Run \`plandesk onboard\` for the full Plan Desk + Factory model and the operating loop.`;

export function buildFactorySentinelBlock(): string {
  return `${FACTORY_SENTINEL_START}\n${FACTORY_SENTINEL_PREAMBLE}\n\n${FACTORY_SENTINEL_INCLUDES.join('\n')}\n${FACTORY_SENTINEL_END}`;
}

export function insertBlock(content: string, block: string, start: string, end: string): string {
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).replace(/\n+$/, '');
    const after = content.slice(endIdx + end.length).replace(/^\n+/, '');
    const parts = [before, block, after].filter((part) => part.length > 0);
    return `${parts.join('\n\n')}\n`;
  }
  if (content.length === 0) {
    return `${block}\n`;
  }
  const base = content.replace(/\n+$/, '');
  return `${base}\n\n${block}\n`;
}

export function insertFactorySentinelBlock(content: string): string {
  return insertBlock(
    content,
    buildFactorySentinelBlock(),
    FACTORY_SENTINEL_START,
    FACTORY_SENTINEL_END,
  );
}

export function insertSentinelBlock(content: string): string {
  const block = buildSentinelBlock();
  const startIdx = content.indexOf(SENTINEL_START);
  const endIdx = content.indexOf(SENTINEL_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).replace(/\n+$/, '');
    const after = content.slice(endIdx + SENTINEL_END.length).replace(/^\n+/, '');
    const parts = [before, block, after].filter((part) => part.length > 0);
    return `${parts.join('\n\n')}\n`;
  }
  if (content.length === 0) {
    return `${block}\n`;
  }
  const base = content.replace(/\n+$/, '');
  return `${base}\n\n${block}\n`;
}

export function removeSentinelBlock(content: string): string | undefined {
  const startIdx = content.indexOf(SENTINEL_START);
  const endIdx = content.indexOf(SENTINEL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return content;
  }
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + SENTINEL_END.length);
  const trimmedBefore = before.replace(/\n+$/, '');
  const trimmedAfter = after.replace(/^\n+/, '');
  if (trimmedBefore.length === 0 && trimmedAfter.length === 0) {
    return undefined;
  }
  if (trimmedBefore.length === 0) {
    return `${trimmedAfter}\n`;
  }
  if (trimmedAfter.length === 0) {
    return `${trimmedBefore}\n`;
  }
  return `${trimmedBefore}\n\n${trimmedAfter}\n`;
}

export function appendGitignoreLine(content: string | undefined, line: string): string {
  const normalizedLine = line.trim();
  if (content === undefined || content.trim() === '') {
    return `${normalizedLine}\n`;
  }
  const lines = content.split('\n');
  if (lines.some((entry) => entry.trim() === normalizedLine)) {
    return content.endsWith('\n') ? content : `${content}\n`;
  }
  const suffix = content.endsWith('\n') ? '' : '\n';
  return `${content}${suffix}${normalizedLine}\n`;
}

export function buildSkillMarkdown(): string {
  return `${PLANDESK_SKILL_TEMPLATE}\n`;
}

export function buildCommandMarkdown(): string {
  return `# Plan Desk

@.plandesk/skill.md
`;
}

export const GITIGNORE_SERVER_INFO_LINE = '.plandesk/server.json';

// --- workspace.json — written by `plandesk init`, stores the board's fixed port ---

export const WORKSPACE_JSON_VERSION = 'plandesk-workspace-v1';

export type WorkspaceJson = {
  version: typeof WORKSPACE_JSON_VERSION;
  port: number;
};

export function readWorkspaceJson(plandeskDir: string): WorkspaceJson | undefined {
  const path = join(plandeskDir, 'workspace.json');
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkspaceJson>;
    if (raw.version !== WORKSPACE_JSON_VERSION || typeof raw.port !== 'number') {
      return undefined;
    }
    return { version: WORKSPACE_JSON_VERSION, port: raw.port };
  } catch {
    return undefined;
  }
}

export function writeWorkspaceJson(plandeskDir: string, port: number): void {
  const workspace: WorkspaceJson = { version: WORKSPACE_JSON_VERSION, port };
  writeFileSync(
    join(plandeskDir, 'workspace.json'),
    `${JSON.stringify(workspace, null, 2)}\n`,
    'utf8',
  );
}

// --- server.json — gitignored, written by `plandesk serve` after bind, deleted on exit ---

export type ServerInfo = {
  port: number;
  pid: number;
  host: string;
  startedAt: string;
};

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerInfo(plandeskDir: string): ServerInfo | undefined {
  const path = join(plandeskDir, 'server.json');
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServerInfo>;
    if (
      typeof raw.port !== 'number' ||
      typeof raw.pid !== 'number' ||
      typeof raw.host !== 'string' ||
      typeof raw.startedAt !== 'string'
    ) {
      return undefined;
    }
    if (!isPidAlive(raw.pid)) {
      return undefined;
    }
    return { port: raw.port, pid: raw.pid, host: raw.host, startedAt: raw.startedAt };
  } catch {
    return undefined;
  }
}

export function writeServerInfo(plandeskDir: string, info: ServerInfo): void {
  const tmpPath = join(plandeskDir, 'server.json.tmp');
  const finalPath = join(plandeskDir, 'server.json');
  writeFileSync(tmpPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, finalPath);
}

export function deleteServerInfo(plandeskDir: string): void {
  rmSync(join(plandeskDir, 'server.json'), { force: true });
}

export function resolveEffectivePort(plandeskDir: string, defaultPort: number): number {
  return readServerInfo(plandeskDir)?.port ?? readWorkspaceJson(plandeskDir)?.port ?? defaultPort;
}

export function committedPaths(repoDir: string): string[] {
  return [
    `${repoDir}/.plandesk/config.json`,
    `${repoDir}/.plandesk/skill.md`,
    `${repoDir}/.claude/skills/plandesk/SKILL.md`,
    `${repoDir}/.agents/skills/plandesk/SKILL.md`,
    `${repoDir}/.claude/commands/plandesk.md`,
    `${repoDir}/.mcp.json`,
    `${repoDir}/CLAUDE.md`,
    `${repoDir}/AGENTS.md`,
    `${repoDir}/.codex/commands/plandesk.md`,
    `${repoDir}/.gitignore`,
  ];
}
