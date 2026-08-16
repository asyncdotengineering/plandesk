import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  DEFAULT_ORG_ID,
  exportProject,
  listProjects,
  type Db,
  type PlandeskExport,
} from '@plandesk/db';
import {
  createBetterAuth,
  ensureLocalBetterAuthOrganization,
  listTeamsForOrg,
  runBetterAuthMigrations,
  type BetterAuthInstance,
} from '@plandesk/api';
import { resolveDataDir } from './args.js';
import { normalizeServerUrl } from './connect-artifacts.js';
import { readCliConfig } from './config.js';
import { ensureLocalBetterAuthSecret } from './init.js';
import { openWorkspace } from './workspace.js';

export class GoOnlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoOnlineError';
  }
}

type LocalWorkspace = { id: string; name: string };

type HostedWorkspace = { id: string; name: string };

type HostedProject = { id: string; name: string; workspace_id?: string };

export type GoOnlineOptions = {
  dataDir?: string;
  /** Hosted org id (overrides CliConfig). */
  to?: string;
  /** Hosted server URL (overrides CliConfig). */
  server?: string;
  /** Hosted owner token (overrides CliConfig). */
  token?: string;
  /** Push every local workspace. */
  all?: boolean;
  /** Push only local workspaces matching these names. */
  workspaces?: string[];
  cwd?: string;
  /** Injectable home for readCliConfig (tests). */
  home?: string;
  /** Injectable stdout for the interactive prompt + report (tests). */
  out?: NodeJS.WritableStream;
  /** Injectable stdin for the interactive prompt (tests). */
  input?: NodeJS.ReadableStream;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
};

export type GoOnlineWorkspaceResult = {
  name: string;
  localTeamId: string;
  hostedTeamId: string;
  created: boolean;
  pushed: number;
  skipped: number;
};

export type GoOnlineResult = {
  server: string;
  orgId: string;
  pushedWorkspaces: number;
  pushedProjects: number;
  perWorkspace: GoOnlineWorkspaceResult[];
};

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function authProblemDetail(status: number): string {
  if (status === 401) {
    return 'Unauthorized — your hosted token was rejected. Run `plandesk login` again.';
  }
  if (status === 403) {
    return 'Forbidden — your hosted token lacks owner access to that org.';
  }
  return '';
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().length > 0 ? ` ${text.trim()}` : '';
  } catch {
    return '';
  }
}

async function listHostedWorkspaces(
  fetcher: typeof fetch,
  serverUrl: string,
  orgId: string,
  token: string,
): Promise<HostedWorkspace[]> {
  const response = await fetcher(
    `${serverUrl}/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
    { headers: authHeaders(token) },
  );
  if (!response.ok) {
    const detail = authProblemDetail(response.status);
    throw new GoOnlineError(
      `Failed to list hosted workspaces (${String(response.status)}).${detail}${await readErrorBody(response)}`,
    );
  }
  const body = (await response.json()) as { workspaces?: HostedWorkspace[] };
  return body.workspaces ?? [];
}

async function createHostedWorkspace(
  fetcher: typeof fetch,
  serverUrl: string,
  orgId: string,
  token: string,
  name: string,
): Promise<HostedWorkspace> {
  const response = await fetcher(
    `${serverUrl}/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  if (!response.ok) {
    const detail = authProblemDetail(response.status);
    throw new GoOnlineError(
      `Failed to create hosted workspace "${name}" (${String(response.status)}).${detail}${await readErrorBody(response)}`,
    );
  }
  return (await response.json()) as HostedWorkspace;
}

async function listHostedProjects(
  fetcher: typeof fetch,
  serverUrl: string,
  token: string,
): Promise<HostedProject[]> {
  const response = await fetcher(`${serverUrl}/api/v1/projects`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const detail = authProblemDetail(response.status);
    throw new GoOnlineError(
      `Failed to list hosted projects (${String(response.status)}).${detail}${await readErrorBody(response)}`,
    );
  }
  return (await response.json()) as HostedProject[];
}

async function importHostedProject(
  fetcher: typeof fetch,
  serverUrl: string,
  orgId: string,
  token: string,
  exported: PlandeskExport,
): Promise<string> {
  const response = await fetcher(`${serverUrl}/api/v1/orgs/${encodeURIComponent(orgId)}/import`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(exported),
  });
  if (!response.ok) {
    const detail = authProblemDetail(response.status);
    throw new GoOnlineError(
      `Failed to import project "${exported.project.name}" (${String(response.status)}).${detail}${await readErrorBody(response)}`,
    );
  }
  const body = (await response.json()) as { globalProjectId?: string };
  if (typeof body.globalProjectId !== 'string' || body.globalProjectId === '') {
    throw new GoOnlineError(`Import of "${exported.project.name}" returned no project id.`);
  }
  return body.globalProjectId;
}

async function moveHostedProjectToWorkspace(
  fetcher: typeof fetch,
  serverUrl: string,
  token: string,
  projectId: string,
  workspaceId: string,
): Promise<void> {
  const response = await fetcher(`${serverUrl}/api/v1/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
  if (!response.ok) {
    const detail = authProblemDetail(response.status);
    throw new GoOnlineError(
      `Failed to move project ${projectId} into workspace ${workspaceId} (${String(response.status)}).${detail}${await readErrorBody(response)}`,
    );
  }
}

function selectWorkspaces(
  local: LocalWorkspace[],
  options: GoOnlineOptions,
  out: NodeJS.WritableStream,
  input: NodeJS.ReadableStream,
): LocalWorkspace[] | Promise<LocalWorkspace[]> {
  if (options.all === true) {
    return local;
  }
  const names = options.workspaces ?? [];
  if (names.length > 0) {
    const byName = new Map(local.map((ws) => [ws.name, ws]));
    const missing = names.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new GoOnlineError(
        `Unknown workspace name: ${missing.join(', ')}. Available: ${local.map((ws) => ws.name).join(', ') || '(none)'}`,
      );
    }
    return names.map((name) => {
      const workspace = byName.get(name);
      if (workspace === undefined) {
        throw new GoOnlineError(`Missing workspace after validating name: ${name}`);
      }
      return workspace;
    });
  }
  return pickWorkspacesInteractively(local, out, input);
}

async function pickWorkspacesInteractively(
  local: LocalWorkspace[],
  out: NodeJS.WritableStream,
  inStream: NodeJS.ReadableStream,
): Promise<LocalWorkspace[]> {
  if (local.length === 0) {
    throw new GoOnlineError('No local workspaces found on the global board.');
  }
  out.write('Local workspaces:\n');
  for (const [index, ws] of local.entries()) {
    out.write(`${String(index + 1)}. ${ws.name}\n`);
  }
  const rl = createInterface({ input: inStream, output: out });
  try {
    const answer = (
      await rl.question('Select workspace numbers (comma-separated), or "all": ')
    ).trim();
    if (answer.toLowerCase() === 'all') {
      return local;
    }
    const picks = answer
      .split(/[,\s]+/)
      .map((part) => Number.parseInt(part, 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= local.length);
    if (picks.length === 0) {
      throw new GoOnlineError('No workspace selected.');
    }
    return picks.map((n) => {
      const workspace = local[n - 1];
      if (workspace === undefined) {
        throw new GoOnlineError(`Missing workspace at selection ${String(n)}.`);
      }
      return workspace;
    });
  } finally {
    rl.close();
  }
}

function resolveHostedTarget(options: GoOnlineOptions): {
  orgId: string;
  server: string;
  token: string;
} {
  const cliConfig =
    options.to === undefined || options.server === undefined || options.token === undefined
      ? readCliConfig(options.home)
      : undefined;

  const orgId = options.to ?? cliConfig?.orgId;
  const server = options.server ?? cliConfig?.server;
  const token = options.token ?? cliConfig?.token;

  if (orgId === undefined || orgId.trim() === '') {
    throw new GoOnlineError('No hosted org id. Pass --to <orgId> or run `plandesk login` first.');
  }
  if (server === undefined || server.trim() === '') {
    throw new GoOnlineError('No hosted server. Pass --server <url> or run `plandesk login` first.');
  }
  if (token === undefined || token.trim() === '') {
    throw new GoOnlineError('No hosted token. Pass --token <key> or run `plandesk login` first.');
  }
  return { orgId: orgId.trim(), server: normalizeServerUrl(server.trim()), token: token.trim() };
}

async function buildLocalAuth(db: Db, dataDir: string): Promise<BetterAuthInstance> {
  const auth = createBetterAuth({
    client: db.$client,
    secret: ensureLocalBetterAuthSecret(dataDir),
    baseURL: 'http://127.0.0.1',
  });
  if (auth === undefined) {
    throw new GoOnlineError('Local better-auth secret was not created.');
  }
  await runBetterAuthMigrations(auth);
  await ensureLocalBetterAuthOrganization(db, auth);
  return auth;
}

export async function runGoOnline(options: GoOnlineOptions): Promise<GoOnlineResult> {
  const target = resolveHostedTarget(options);
  const fetcher = options.fetchImpl ?? fetch;
  const out = options.out ?? output;

  const dataDir = resolveDataDir(options.dataDir, options.cwd);
  const { db } = await openWorkspace(dataDir);
  const auth = await buildLocalAuth(db, dataDir);

  const localTeams = await listTeamsForOrg(auth, DEFAULT_ORG_ID);
  const selected = await selectWorkspaces(localTeams, options, out, options.input ?? input);

  const perWorkspace: GoOnlineWorkspaceResult[] = [];
  let pushedProjects = 0;

  for (const localTeam of selected) {
    const hosted = await reuseOrCreateHostedWorkspace(fetcher, target, localTeam.name);
    const hostedProjects = await listHostedProjects(fetcher, target.server, target.token);
    const existingNames = new Set(
      hostedProjects.filter((p) => p.workspace_id === hosted.id).map((p) => p.name),
    );

    const localProjects = await listProjects(db, DEFAULT_ORG_ID, { workspaceId: localTeam.id });

    let pushed = 0;
    let skipped = 0;
    for (const project of localProjects) {
      if (existingNames.has(project.name)) {
        skipped += 1;
        continue;
      }
      const exported = await exportProject(db, project.id);
      if (exported === undefined) {
        continue;
      }
      const hostedProjectId = await importHostedProject(
        fetcher,
        target.server,
        target.orgId,
        target.token,
        exported,
      );
      // The import route lands the project in the org-default workspace; move it
      // into this workspace so each hosted project.workspace_id matches its team.
      await moveHostedProjectToWorkspace(
        fetcher,
        target.server,
        target.token,
        hostedProjectId,
        hosted.id,
      );
      pushed += 1;
    }

    pushedProjects += pushed;
    perWorkspace.push({
      name: localTeam.name,
      localTeamId: localTeam.id,
      hostedTeamId: hosted.id,
      created: hosted.created,
      pushed,
      skipped,
    });
  }

  const result: GoOnlineResult = {
    server: target.server,
    orgId: target.orgId,
    pushedWorkspaces: perWorkspace.length,
    pushedProjects,
    perWorkspace,
  };
  return result;
}

type ReusedOrCreated = HostedWorkspace & { created: boolean };

async function reuseOrCreateHostedWorkspace(
  fetcher: typeof fetch,
  target: { server: string; orgId: string; token: string },
  name: string,
): Promise<ReusedOrCreated> {
  const existing = await listHostedWorkspaces(fetcher, target.server, target.orgId, target.token);
  const match = existing.find((ws) => ws.name === name);
  if (match !== undefined) {
    return { ...match, created: false };
  }
  const created = await createHostedWorkspace(
    fetcher,
    target.server,
    target.orgId,
    target.token,
    name,
  );
  return { ...created, created: true };
}

export function formatGoOnlineSummary(result: GoOnlineResult): string {
  const lines: string[] = [];
  lines.push(
    `pushed ${String(result.pushedProjects)} projects across ${String(result.pushedWorkspaces)} workspaces to ${result.server} (org ${result.orgId})`,
  );
  for (const ws of result.perWorkspace) {
    lines.push(
      `  ${ws.name}: ${String(ws.pushed)} pushed, ${String(ws.skipped)} skipped (hosted workspace ${ws.hostedTeamId})`,
    );
  }
  lines.push(
    'Connect a repo to a hosted project with `plandesk connect --to <org> --project <name>`.',
  );
  return `${lines.join('\n')}\n`;
}
