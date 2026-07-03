import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  appendGitignoreLine,
  buildCommandMarkdown,
  buildConfigJson,
  buildSkillMarkdown,
  GITIGNORE_SERVER_INFO_LINE,
  GITIGNORE_TOKEN_LINE,
  globalDirRefusalReason,
  mergeMcpJson,
  normalizeServerUrl,
  parseConfigJson,
  resolveEffectivePort,
  insertSentinelBlock,
  SKILL_DIRS,
  SKILL_SYMLINK_TARGET,
  TOKEN_ENV_VAR,
  type PlanDeskConfig,
} from './connect-artifacts.js';
import { DEFAULT_PORT } from './args.js';

export type ProjectSummary = {
  id: string;
  name: string;
};

export type ConnectAgent = 'claude' | 'codex' | 'both' | 'detect';

export type ConnectOptions = {
  repoDir: string;
  project?: string;
  url?: string;
  token?: string;
  agent?: ConnectAgent;
  print?: boolean;
  interactive?: boolean;
};

export type ConnectArtifact = {
  path: string;
  content: string;
  action: 'create' | 'update' | 'delete';
  symlinkTarget?: string;
};

export type ConnectResult = {
  project: ProjectSummary;
  serverUrl: string;
  artifacts: ConnectArtifact[];
  tokenCreated: boolean;
  tokenLine: string;
};

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

function resolveDefaultServerUrl(repoDir: string): string {
  const plandeskDir = join(repoDir, '.plandesk');
  return `http://127.0.0.1:${String(resolveEffectivePort(plandeskDir, DEFAULT_PORT))}`;
}

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, 'utf8');
}

async function fetchProjects(serverUrl: string): Promise<ProjectSummary[]> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/v1/projects`);
  if (!response.ok) {
    throw new ConnectError(
      `Plan Desk server unreachable at ${serverUrl}. Start it with \`plandesk serve\`.`,
    );
  }
  const projects = (await response.json()) as ProjectSummary[];
  return projects;
}

async function createTokenViaApi(serverUrl: string): Promise<string> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/v1/mcp-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'plandesk connect' }),
  });
  if (!response.ok) {
    throw new ConnectError(
      `Failed to create MCP token at ${serverUrl}. Start the server with \`plandesk serve\`.`,
    );
  }
  const body = (await response.json()) as { token?: string };
  if (typeof body.token !== 'string' || body.token.trim() === '') {
    throw new ConnectError('Token API returned an invalid response.');
  }
  return body.token;
}

function matchProjects(projects: ProjectSummary[], query: string): ProjectSummary[] {
  const normalized = query.trim().toLowerCase();
  const byId = projects.filter((project) => project.id === query);
  if (byId.length > 0) {
    return byId;
  }
  return projects.filter((project) => project.name.toLowerCase() === normalized);
}

function matchRepoName(projects: ProjectSummary[], repoDir: string): ProjectSummary[] {
  const repoName = basename(repoDir).toLowerCase();
  return projects.filter((project) => project.name.toLowerCase() === repoName);
}

async function pickProjectInteractively(candidates: ProjectSummary[]): Promise<ProjectSummary> {
  const rl = createInterface({ input, output });
  try {
    for (const [index, project] of candidates.entries()) {
      process.stdout.write(`${String(index + 1)}. ${project.name} (${project.id})\n`);
    }
    const answer = await rl.question('Select project number: ');
    const selected = Number.parseInt(answer.trim(), 10);
    const project = candidates[selected - 1];
    if (project === undefined) {
      throw new ConnectError('Invalid project selection.');
    }
    return project;
  } finally {
    rl.close();
  }
}

async function resolveProject(
  options: ConnectOptions,
  serverUrl: string,
): Promise<{ project: ProjectSummary; explicitProject: boolean }> {
  const configPath = join(options.repoDir, '.plandesk', 'config.json');
  const existingConfig = readOptionalFile(configPath);
  const projects = await fetchProjects(serverUrl);

  if (options.project !== undefined) {
    const matches = matchProjects(projects, options.project);
    if (matches.length === 0) {
      throw new ConnectError(`No project matches "${options.project}".`);
    }
    if (matches.length > 1) {
      throw new ConnectError(
        `Multiple projects match "${options.project}": ${matches.map((p) => p.name).join(', ')}`,
      );
    }
    const match = matches[0];
    if (match === undefined) {
      throw new ConnectError(`No project matches "${options.project}".`);
    }
    return { project: match, explicitProject: true };
  }

  if (existingConfig !== undefined) {
    const config = parseConfigJson(existingConfig);
    const bound = projects.find((project) => project.id === config.projectId);
    if (bound !== undefined) {
      return { project: bound, explicitProject: false };
    }
    throw new ConnectError(
      `Bound project ${config.projectId} no longer exists on the server. Rebind with --project.`,
    );
  }

  const repoMatches = matchRepoName(projects, options.repoDir);
  if (repoMatches.length === 1) {
    const match = repoMatches[0];
    if (match === undefined) {
      throw new ConnectError('Failed to resolve project from repo name.');
    }
    return { project: match, explicitProject: false };
  }
  if (repoMatches.length > 1) {
    throw new ConnectError(
      `Multiple projects match repo name "${basename(options.repoDir)}": ${repoMatches.map((p) => p.name).join(', ')}. Use --project.`,
    );
  }

  if (projects.length === 1) {
    const only = projects[0];
    if (only === undefined) {
      throw new ConnectError('No projects found on the server. Create one first.');
    }
    return { project: only, explicitProject: false };
  }

  const interactive = options.interactive ?? true;
  if (!interactive) {
    if (projects.length === 0) {
      throw new ConnectError('No projects found on the server. Create one first.');
    }
    throw new ConnectError(
      `Multiple projects available and no --project specified: ${projects.map((p) => p.name).join(', ')}`,
    );
  }

  if (projects.length === 0) {
    throw new ConnectError('No projects found on the server. Create one first.');
  }

  const picked = await pickProjectInteractively(projects);
  return { project: picked, explicitProject: false };
}

function assertRebindAllowed(
  existingConfig: PlanDeskConfig | undefined,
  project: ProjectSummary,
  explicitProject: boolean,
): void {
  if (existingConfig === undefined) {
    return;
  }
  if (existingConfig.projectId === project.id) {
    return;
  }
  if (!explicitProject) {
    throw new ConnectError(
      `Repo is bound to project "${existingConfig.projectName}" (${existingConfig.projectId}). Rebind with --project.`,
    );
  }
}

export function resolveAgents(repoDir: string, agent: ConnectAgent): { claude: boolean; codex: boolean } {
  if (agent === 'claude') {
    return { claude: true, codex: false };
  }
  if (agent === 'codex') {
    return { claude: false, codex: true };
  }
  if (agent === 'both') {
    return { claude: true, codex: true };
  }

  const hasCodex = existsSync(join(repoDir, '.codex'));
  const hasClaude =
    existsSync(join(repoDir, 'CLAUDE.md')) || existsSync(join(repoDir, 'AGENTS.md'));
  if (hasCodex && hasClaude) {
    return { claude: true, codex: true };
  }
  if (hasCodex) {
    return { claude: false, codex: true };
  }
  if (hasClaude) {
    return { claude: true, codex: false };
  }
  return { claude: true, codex: true };
}

async function ensureToken(
  options: ConnectOptions,
  serverUrl: string,
): Promise<{ token: string; created: boolean }> {
  if (options.token !== undefined) {
    return { token: options.token, created: false };
  }

  const tokenPath = join(options.repoDir, '.plandesk', 'token');
  const existingToken = readOptionalFile(tokenPath)?.trim();
  if (existingToken !== undefined && existingToken !== '') {
    return { token: existingToken, created: false };
  }

  const token = await createTokenViaApi(serverUrl);
  return { token, created: true };
}

function buildArtifacts(
  options: ConnectOptions,
  serverUrl: string,
  project: ProjectSummary,
  token: string,
  agents: { claude: boolean; codex: boolean },
): ConnectArtifact[] {
  const artifacts: ConnectArtifact[] = [];
  const plandeskDir = join(options.repoDir, '.plandesk');

  artifacts.push({
    path: join(plandeskDir, 'config.json'),
    content: buildConfigJson({
      serverUrl,
      projectId: project.id,
      projectName: project.name,
    }),
    action: existsSync(join(plandeskDir, 'config.json')) ? 'update' : 'create',
  });

  artifacts.push({
    path: join(plandeskDir, 'skill.md'),
    content: buildSkillMarkdown(),
    action: existsSync(join(plandeskDir, 'skill.md')) ? 'update' : 'create',
  });

  for (const skillDir of SKILL_DIRS) {
    const linkPath = join(options.repoDir, skillDir, 'SKILL.md');
    artifacts.push({
      path: linkPath,
      content: buildSkillMarkdown(),
      action: lstatSync(linkPath, { throwIfNoEntry: false }) === undefined ? 'create' : 'update',
      symlinkTarget: SKILL_SYMLINK_TARGET,
    });
  }

  artifacts.push({
    path: join(plandeskDir, 'token'),
    content: `${token}\n`,
    action: existsSync(join(plandeskDir, 'token')) ? 'update' : 'create',
  });

  const mcpPath = join(options.repoDir, '.mcp.json');
  artifacts.push({
    path: mcpPath,
    content: mergeMcpJson(readOptionalFile(mcpPath), serverUrl),
    action: existsSync(mcpPath) ? 'update' : 'create',
  });

  if (agents.claude) {
    const claudePath = join(options.repoDir, 'CLAUDE.md');
    const claudeContent = insertSentinelBlock(readOptionalFile(claudePath) ?? '');
    artifacts.push({
      path: claudePath,
      content: claudeContent,
      action: existsSync(claudePath) ? 'update' : 'create',
    });

    const claudeCommandPath = join(options.repoDir, '.claude', 'commands', 'plandesk.md');
    artifacts.push({
      path: claudeCommandPath,
      content: buildCommandMarkdown(),
      action: existsSync(claudeCommandPath) ? 'update' : 'create',
    });

    const agentsPath = join(options.repoDir, 'AGENTS.md');
    if (existsSync(agentsPath)) {
      artifacts.push({
        path: agentsPath,
        content: insertSentinelBlock(readOptionalFile(agentsPath) ?? ''),
        action: 'update',
      });
    }
  }

  if (agents.codex) {
    const codexPath = join(options.repoDir, '.codex', 'commands', 'plandesk.md');
    artifacts.push({
      path: codexPath,
      content: buildCommandMarkdown(),
      action: existsSync(codexPath) ? 'update' : 'create',
    });
  }

  const gitignorePath = join(options.repoDir, '.gitignore');
  const currentGitignore = readOptionalFile(gitignorePath);
  const withToken = appendGitignoreLine(currentGitignore, GITIGNORE_TOKEN_LINE);
  const withServerInfo = appendGitignoreLine(withToken, GITIGNORE_SERVER_INFO_LINE);
  artifacts.push({
    path: gitignorePath,
    content: withServerInfo,
    action: existsSync(gitignorePath) ? 'update' : 'create',
  });

  return artifacts;
}

function writeArtifacts(artifacts: ConnectArtifact[]): void {
  for (const artifact of artifacts) {
    mkdirSync(dirname(artifact.path), { recursive: true });
    if (artifact.symlinkTarget === undefined) {
      writeFileSync(artifact.path, artifact.content, 'utf8');
      continue;
    }
    rmSync(artifact.path, { force: true });
    try {
      symlinkSync(artifact.symlinkTarget, artifact.path);
    } catch {
      // Symlinks unavailable (e.g. unprivileged Windows) — write a copy.
      writeFileSync(artifact.path, artifact.content, 'utf8');
    }
  }
}

function redactArtifactContent(path: string, content: string): string {
  if (path.endsWith('/.plandesk/token') || path.endsWith('.plandesk/token')) {
    return '<gitignored token>\n';
  }
  return content;
}

export function formatConnectPrint(result: ConnectResult): string {
  const lines: string[] = [];
  lines.push(`# plandesk connect --print`);
  lines.push(`project: ${result.project.name} (${result.project.id})`);
  lines.push(`server: ${result.serverUrl}`);
  lines.push('');
  for (const artifact of result.artifacts) {
    if (artifact.symlinkTarget !== undefined) {
      lines.push(`--- ${artifact.action.toUpperCase()} ${artifact.path} -> ${artifact.symlinkTarget}`);
      continue;
    }
    lines.push(`--- ${artifact.action.toUpperCase()} ${artifact.path}`);
    lines.push(redactArtifactContent(artifact.path, artifact.content));
    if (!artifact.content.endsWith('\n')) {
      lines.push('');
    }
  }
  lines.push(`Token is read from .plandesk/token automatically (set ${TOKEN_ENV_VAR} to override).`);
  lines.push('Start a new agent session to refresh MCP tools.');
  return `${lines.join('\n')}\n`;
}

export function formatConnectSummary(result: ConnectResult): string {
  const lines: string[] = [];
  lines.push(`Connected ${result.project.name} (${result.project.id})`);
  lines.push(`server: ${result.serverUrl}`);
  for (const artifact of result.artifacts) {
    lines.push(
      artifact.symlinkTarget === undefined
        ? `${artifact.action}: ${artifact.path}`
        : `${artifact.action}: ${artifact.path} -> ${artifact.symlinkTarget}`,
    );
  }
  lines.push(result.tokenLine);
  lines.push('Start a new agent session to refresh MCP tools.');
  return `${lines.join('\n')}\n`;
}

export async function runConnect(options: ConnectOptions): Promise<ConnectResult> {
  const globalRefusal = globalDirRefusalReason(options.repoDir);
  if (globalRefusal !== undefined) {
    throw new ConnectError(
      `Refusing to connect ${globalRefusal}: connect writes CLAUDE.md includes and agent config that would leak into every project on this machine. Run from a project repository (or pass --repo <dir>).`,
    );
  }

  const serverUrl = normalizeServerUrl(options.url ?? resolveDefaultServerUrl(options.repoDir));
  const configPath = join(options.repoDir, '.plandesk', 'config.json');
  const existingConfigContent = readOptionalFile(configPath);
  const existingConfig =
    existingConfigContent !== undefined ? parseConfigJson(existingConfigContent) : undefined;

  const { project, explicitProject } = await resolveProject(options, serverUrl);
  assertRebindAllowed(existingConfig, project, explicitProject);

  const { token, created } = await ensureToken(options, serverUrl);
  const agents = resolveAgents(options.repoDir, options.agent ?? 'detect');
  const artifacts = buildArtifacts(options, serverUrl, project, token, agents);

  const result: ConnectResult = {
    project,
    serverUrl,
    artifacts,
    tokenCreated: created,
    tokenLine: `Token saved to .plandesk/token (gitignored) — .mcp.json reads it automatically; set ${TOKEN_ENV_VAR} to override.`,
  };

  if (options.print === true) {
    return result;
  }

  writeArtifacts(artifacts);
  return result;
}
