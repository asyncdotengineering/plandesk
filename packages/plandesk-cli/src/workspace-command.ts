import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ORG_ID } from '@plandesk/db';
import { normalizeServerUrl } from './connect-artifacts.js';
import { readCliConfig } from './config.js';

export class WorkspaceCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'WorkspaceCommandError';
  }
}

type WorkspaceSummary = {
  id: string;
  name: string;
};

function resolveOrgId(to: string | undefined): string {
  if (to !== undefined && to.trim() !== '') {
    return to.trim();
  }
  return DEFAULT_ORG_ID;
}

function resolveServerUrl(to: string | undefined, repoDir: string): string {
  if (to !== undefined && to.trim() !== '') {
    const home = homedir();
    const cliConfig = readCliConfig(home);
    if (cliConfig === undefined) {
      throw new WorkspaceCommandError('Not logged in. Run `plandesk login` first for hosted orgs.');
    }
    if (cliConfig.orgId !== to.trim()) {
      throw new WorkspaceCommandError(
        `Logged in to org ${cliConfig.orgId}, but --to is ${to.trim()}. Run \`plandesk login\` for that org, or pass the matching --to.`,
      );
    }
    return normalizeServerUrl(cliConfig.server);
  }

  // Local: derive from repoDir's .plandesk/config.json or default loopback.
  const configPath = join(repoDir, '.plandesk', 'config.json');
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { serverUrl?: string };
    if (typeof raw.serverUrl === 'string') {
      return normalizeServerUrl(raw.serverUrl);
    }
  } catch {
    // fallthrough
  }
  return 'http://127.0.0.1:3847';
}

async function fetchWorkspaces(
  serverUrl: string,
  orgId: string,
  token?: string,
): Promise<WorkspaceSummary[]> {
  const headers: Record<string, string> = {};
  if (token !== undefined && token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(
    `${normalizeServerUrl(serverUrl)}/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
    { headers },
  );
  if (!response.ok) {
    throw new WorkspaceCommandError(
      `Failed to list workspaces (${String(response.status)}).`,
    );
  }
  const body = (await response.json()) as { workspaces: WorkspaceSummary[] };
  return body.workspaces ?? [];
}

async function createWorkspaceViaApi(
  serverUrl: string,
  orgId: string,
  name: string,
  token: string,
): Promise<WorkspaceSummary> {
  const response = await fetch(
    `${normalizeServerUrl(serverUrl)}/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    },
  );
  if (!response.ok) {
    throw new WorkspaceCommandError(
      `Failed to create workspace (${String(response.status)}).`,
    );
  }
  const body = (await response.json()) as { id: string; name: string };
  return { id: body.id, name: body.name };
}

export async function runWorkspaceList(options: {
  repoDir: string;
  to?: string;
}): Promise<void> {
  const orgId = resolveOrgId(options.to);
  const serverUrl = resolveServerUrl(options.to, options.repoDir);

  let token: string | undefined;
  if (options.to !== undefined) {
    const cliConfig = readCliConfig(homedir());
    token = cliConfig?.token;
  }

  const workspaces = await fetchWorkspaces(serverUrl, orgId, token);
  if (workspaces.length === 0) {
    process.stdout.write('No workspaces found.\n');
    return;
  }
  const maxName = Math.max(4, ...workspaces.map((w) => w.name.length));
  process.stdout.write(`${'NAME'.padEnd(maxName)}  ID\n`);
  process.stdout.write(`${'-'.repeat(maxName)}  ${'-'.repeat(36)}\n`);
  for (const ws of workspaces) {
    process.stdout.write(`${ws.name.padEnd(maxName)}  ${ws.id}\n`);
  }
}

export async function runWorkspaceCreate(options: {
  repoDir: string;
  name: string;
  to?: string;
}): Promise<void> {
  const orgId = resolveOrgId(options.to);
  const serverUrl = resolveServerUrl(options.to, options.repoDir);

  let token: string | undefined;
  if (options.to !== undefined) {
    const cliConfig = readCliConfig(homedir());
    if (cliConfig === undefined) {
      throw new WorkspaceCommandError('Not logged in. Run `plandesk login` first.');
    }
    token = cliConfig.token;
  }

  const workspace = await createWorkspaceViaApi(serverUrl, orgId, options.name, token ?? '');
  process.stdout.write(`Created workspace "${workspace.name}" (${workspace.id})\n`);
}
