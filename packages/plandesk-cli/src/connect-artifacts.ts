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
export const GLOBAL_CONFIG_DIR_NAMES = ['.claude', '.codex', '.agents', '.config', '.plandesk'] as const;

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
  sync?: PlanDeskSyncConfig;
}): string {
  const config: PlanDeskConfig = {
    version: PLANDESK_CONNECT_VERSION,
    serverUrl: normalizeServerUrl(input.serverUrl),
    projectId: input.projectId,
    projectName: input.projectName,
  };
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
  token: string;
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

// Resolves a repo's Plan Desk binding (config + token) for commands that talk to
// the remote server over HTTP. Returns undefined if the repo isn't connected —
// callers treat that as an idle no-op, never an error.
export function resolvePlandeskBinding(repoDir: string): PlanDeskBinding | undefined {
  const config = readPlandeskConfig(repoDir);
  if (!config) {
    return undefined;
  }
  const token = readPlandeskToken(repoDir);
  if (!token) {
    return undefined;
  }
  return { config, token };
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

// Factory policy rides always-on next to the plandesk conventions: workflow.md
// and factory.md change agent behavior at every decision point (a pointer the
// agent may not follow is not a gate). Dispatch DATA (protocol, workers, lanes,
// verifiers) stays on-demand — it is read at dispatch/gate time.
export const FACTORY_SENTINEL_START = '<!-- plandesk-factory:start -->';
export const FACTORY_SENTINEL_END = '<!-- plandesk-factory:end -->';
export const FACTORY_SENTINEL_INCLUDES = ['@.agents/factory/workflow.md', '@.agents/factory/factory.md'];

export function buildFactorySentinelBlock(): string {
  return `${FACTORY_SENTINEL_START}\n${FACTORY_SENTINEL_INCLUDES.join('\n')}\n${FACTORY_SENTINEL_END}`;
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
  return insertBlock(content, buildFactorySentinelBlock(), FACTORY_SENTINEL_START, FACTORY_SENTINEL_END);
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

// --- workspace.json — committed, written by `plandesk init`, stores the assigned port ---

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
  writeFileSync(join(plandeskDir, 'workspace.json'), `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
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
