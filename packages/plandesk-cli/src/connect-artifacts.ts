import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PLANDESK_SKILL_TEMPLATE } from './skill-template.js';

export const PLANDESK_CONNECT_VERSION = 'plandesk-connect-v1';
export const PLANDESK_CONNECT_VERSION_V2 = 'plandesk-connect-v2';
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

export type PlanDeskConfigV2 = {
  version: typeof PLANDESK_CONNECT_VERSION_V2;
  serverUrl: string;
  orgId: string;
  workspaceId: string;
  workspaceName: string;
  projectIds: string[];
  sync?: PlanDeskSyncConfig;
};

export type AnyPlanDeskConfig = PlanDeskConfig | PlanDeskConfigV2;

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

/**
 * True when `repoDir` is Plan Desk's own source tree.
 *
 * Here `.agents/` is not a scaffold — it is the source that
 * `scripts/copy-templates.mjs` vendors into `dist/templates`. Scaffolding into
 * it writes the *output* shape back over the *input*: observed live, a sync run
 * wrapped `.agents/index.md` in the sentinel markers the CLI is supposed to
 * insert, so the template then carried its own markers and every consumer got
 * two. Detection keys on that script because vendoring `.agents/` is its whole
 * job, which makes its presence definitional rather than incidental.
 */
export function isPlandeskSourceRepo(repoDir: string): boolean {
  return existsSync(join(resolve(repoDir), 'packages', 'plandesk-cli', 'scripts', 'copy-templates.mjs'));
}

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

/**
 * Query a running server's /api/v1/health for the board it actually serves.
 * Returns undefined on any failure (unreachable, non-200, no dataDir in the
 * response) — callers treat that as "identity unknown", not an error.
 */
export async function fetchServedDataDir(serverUrl: string): Promise<string | undefined> {
  try {
    // Whatever holds the port might not even be an HTTP server (a foreign
    // process, a stalled listener) — bound the wait so identity checks (and
    // the EADDRINUSE handler, REQ-A3c) never hang the CLI.
    const res = await fetch(`${normalizeServerUrl(serverUrl)}/api/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return undefined;
    }
    const body = (await res.json()) as { dataDir?: unknown };
    return typeof body.dataDir === 'string' ? body.dataDir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify identity, not just liveness (REQ-A3b): a 200 from a server does not
 * mean it is serving the board a caller expects — two boards can share the
 * same default port across different repos/machines.
 */
export async function isServingExpectedBoard(
  serverUrl: string,
  expectedDataDir: string,
): Promise<boolean> {
  const served = await fetchServedDataDir(serverUrl);
  return served === expectedDataDir;
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

export function buildConfigJsonV2(input: {
  serverUrl: string;
  orgId: string;
  workspaceId: string;
  workspaceName: string;
  projectIds: string[];
  sync?: PlanDeskSyncConfig;
}): string {
  const config: PlanDeskConfigV2 = {
    version: PLANDESK_CONNECT_VERSION_V2,
    serverUrl: normalizeServerUrl(input.serverUrl),
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    projectIds: input.projectIds,
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
  config: AnyPlanDeskConfig;
  /** Present for hosted agent keys; absent for local loopback (owner without token). */
  token?: string;
};

export function readPlandeskConfig(repoDir: string): AnyPlanDeskConfig | undefined {
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

export function isPlanDeskConfigV2(config: AnyPlanDeskConfig): config is PlanDeskConfigV2 {
  return config.version === PLANDESK_CONNECT_VERSION_V2;
}

export function getBoundProjectIds(config: AnyPlanDeskConfig): string[] {
  if (isPlanDeskConfigV2(config)) {
    return [...config.projectIds];
  }
  return [config.projectId];
}

export function getBoundProjectId(config: AnyPlanDeskConfig): string | undefined {
  if (isPlanDeskConfigV2(config)) {
    return config.projectIds[0];
  }
  return config.projectId;
}

export function parseConfigJson(content: string): AnyPlanDeskConfig {
  const parsed = JSON.parse(content) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid config.json shape');
  }
  const obj = parsed as Record<string, unknown>;
  const version = obj['version'];

  if (version === PLANDESK_CONNECT_VERSION_V2) {
    const projectIdsRaw = obj['projectIds'];
    if (
      typeof obj['serverUrl'] !== 'string' ||
      typeof obj['orgId'] !== 'string' ||
      typeof obj['workspaceId'] !== 'string' ||
      typeof obj['workspaceName'] !== 'string' ||
      !Array.isArray(projectIdsRaw) ||
      !projectIdsRaw.every((id): id is string => typeof id === 'string')
    ) {
      throw new Error('invalid config.json v2 shape');
    }
    const config: PlanDeskConfigV2 = {
      version: PLANDESK_CONNECT_VERSION_V2,
      serverUrl: normalizeServerUrl(obj['serverUrl']),
      orgId: obj['orgId'],
      workspaceId: obj['workspaceId'],
      workspaceName: obj['workspaceName'],
      projectIds: [...projectIdsRaw],
    };
    const sync = parseSyncConfig(obj['sync']);
    if (sync !== undefined) {
      config.sync = sync;
    }
    return config;
  }

  // Grace-read v1 (or omitted version, treated as v1).
  if (
    typeof obj['serverUrl'] !== 'string' ||
    typeof obj['projectId'] !== 'string' ||
    typeof obj['projectName'] !== 'string'
  ) {
    throw new Error('invalid config.json shape');
  }
  const config: PlanDeskConfig = {
    version: PLANDESK_CONNECT_VERSION,
    serverUrl: normalizeServerUrl(obj['serverUrl']),
    projectId: obj['projectId'],
    projectName: obj['projectName'],
  };
  if (typeof obj['orgId'] === 'string' && obj['orgId'].trim() !== '') {
    config.orgId = obj['orgId'].trim();
  }
  const sync = parseSyncConfig(obj['sync']);
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

export function buildMcpServerEntry(
  serverUrl: string,
  workspaceId?: string,
): NonNullable<McpJson['mcpServers']>[string] {
  const entry: NonNullable<McpJson['mcpServers']>[string] = {
    type: 'http',
    url: buildMcpUrl(serverUrl),
    headersHelper: buildHeadersHelper(),
  };
  if (workspaceId !== undefined && workspaceId.trim() !== '') {
    entry.headers = { 'x-plandesk-workspace-id': workspaceId.trim() };
  }
  return entry;
}

export function mergeMcpJson(
  existingContent: string | undefined,
  serverUrl: string,
  workspaceId?: string,
): string {
  let doc: McpJson = {};
  if (existingContent !== undefined && existingContent.trim() !== '') {
    doc = JSON.parse(existingContent) as McpJson;
  }
  const servers = doc.mcpServers ?? {};
  servers[MCP_SERVER_KEY] = buildMcpServerEntry(serverUrl, workspaceId);
  doc.mcpServers = servers;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Curator hooks (F1): a `.claude/settings.json` `hooks` block merged from the
// project-local snippet. Plan Desk owns entries marked `_plandesk` — on each
// merge those are dropped and the current snippet set is re-inserted, so path
// or matcher changes reclaim cleanly. Untagged entries are never touched,
// except a one-time legacy sweep for pre-marker curator hook paths (see below).
export type SettingsJson = {
  hooks?: Record<string, unknown[]>;
};

// Ownership marker written on every Plan Desk hook entry in the snippet.
// Present → drop-and-replace on merge. Absent → leave alone (user-owned).
function isPlandeskOwnedEntry(entry: unknown): boolean {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    Object.prototype.hasOwnProperty.call(entry, '_plandesk')
  );
}

// Pre-marker path used by every shipped curator hook before ownership tags.
// One-time migration: drop untagged entries whose command still points here so
// a first post-upgrade `factory init` converges without leaving orphans.
// Removable after one release cycle (see CHANGELOG).
const LEGACY_CURATOR_HOOKS_PATH = '.agents/curator/hooks/';

function entryCommandContains(entry: unknown, needle: string): boolean {
  if (entry === null || typeof entry !== 'object') {
    return false;
  }
  if (Array.isArray(entry)) {
    return entry.some((item) => entryCommandContains(item, needle));
  }
  const obj = entry as Record<string, unknown>;
  if (typeof obj['command'] === 'string' && obj['command'].includes(needle)) {
    return true;
  }
  return Object.values(obj).some((value) => entryCommandContains(value, needle));
}

function isLegacyUntaggedCuratorEntry(entry: unknown): boolean {
  if (isPlandeskOwnedEntry(entry)) {
    return false;
  }
  return entryCommandContains(entry, LEGACY_CURATOR_HOOKS_PATH);
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
    // Drop Plan Desk–owned and legacy untagged curator entries, keep user hooks.
    const kept = existingEntries.filter(
      (entry) => !isPlandeskOwnedEntry(entry) && !isLegacyUntaggedCuratorEntry(entry),
    );
    hooks[event] = [...kept, ...snippetEntries];
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
// change behavior. The IC execution spine (execution.md) is named by path in the
// preamble and read when needed — inlining it every session is noise a capable
// agent skims past. Dispatch DATA (protocol, workers, lanes, verifiers) stays
// on-demand too.
export const FACTORY_SENTINEL_START = '<!-- plandesk-factory:start -->';
export const FACTORY_SENTINEL_END = '<!-- plandesk-factory:end -->';
export const FACTORY_SENTINEL_INCLUDES = ['@.agents/factory/factory.md'];

// Always-on directive prose inserted into CLAUDE.md / AGENTS.md. This preamble is
// the behavioral gate; the single @-include above pulls the per-item contract.
// The other policy docs are referenced by path here, not inlined.
export const FACTORY_SENTINEL_PREAMBLE = `## Plan Desk Factory — default operating mode

This repository runs on the Factory workflow. On any work request:
1. **Follow the factory cycle** — the always-on [factory.md](.agents/factory/factory.md) contract governs each work item: pull → read → red gate → delegate → prove → observe → gate → ship. Bracket the session with \`start_agent_run\` / \`complete_agent_run\`; call \`record_agent_progress\` every cycle.
2. **Delegate implementation by default — when a worker is available.** The supervisor orchestrates; IC workers execute. Probe the dispatchers in [.agents/factory/workers/](.agents/factory/workers/) per [protocol.md](.agents/factory/protocol.md) and hand each work item to a probed worker. **If no worker is installed on this machine, do the work yourself under the same contract** — never skip the cycle just because you are the one typing, and never assume a delegation skill or worker CLI exists that this repo did not ship. Write inline without dispatch only for trivial edits, integration/conflict resolution, and review fixes under ~5 lines.
3. **Execute without pausing** — decompose the goal into verifiable moves on a harness task list (\`TaskCreate\` / \`TaskList\` / \`TaskUpdate\`), drive them to zero, and ship finished work without pausing for permission. The IC spine is [execution.md](.agents/factory/execution.md).
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

// Shared-file ownership for `.agents/index.md`: Plan Desk contributes a sentinel
// block only. Never whole-file write, never skip — regenerated every init/sync so
// the map cannot go stale when another tool owns the rest of the file.
export const AGENTS_INDEX_SENTINEL_START = '<!-- plandesk-agents-index:start -->';
export const AGENTS_INDEX_SENTINEL_END = '<!-- plandesk-agents-index:end -->';

export function buildAgentsIndexSentinelBlock(body: string): string {
  const trimmed = body.replace(/\n+$/, '');
  return `${AGENTS_INDEX_SENTINEL_START}\n${trimmed}\n${AGENTS_INDEX_SENTINEL_END}`;
}

export function insertAgentsIndexBlock(content: string, body: string): string {
  const block = buildAgentsIndexSentinelBlock(body);
  // Upgrade path: prior whole-file index (byte-identical to the block body) is
  // replaced by the sentinel form so re-init does not leave a duplicate map.
  const normalizedExisting = content.replace(/\n+$/, '');
  const normalizedBody = body.replace(/\n+$/, '');
  if (normalizedExisting === normalizedBody) {
    return insertBlock('', block, AGENTS_INDEX_SENTINEL_START, AGENTS_INDEX_SENTINEL_END);
  }
  return insertBlock(content, block, AGENTS_INDEX_SENTINEL_START, AGENTS_INDEX_SENTINEL_END);
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
  /** Board this server serves. Optional so older server.json files stay readable (REQ-A3a). */
  dataDir?: string;
};

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Parses server.json without judging PID liveness — `status` (REQ-A4) needs the stale case too. */
export function readServerInfoRaw(plandeskDir: string): ServerInfo | undefined {
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
    return {
      port: raw.port,
      pid: raw.pid,
      host: raw.host,
      startedAt: raw.startedAt,
      ...(typeof raw.dataDir === 'string' ? { dataDir: raw.dataDir } : {}),
    };
  } catch {
    return undefined;
  }
}

export function readServerInfo(plandeskDir: string): ServerInfo | undefined {
  const info = readServerInfoRaw(plandeskDir);
  if (info === undefined || !isPidAlive(info.pid)) {
    return undefined;
  }
  return info;
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
