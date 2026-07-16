import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  exportProject,
  setSyncRemote,
  type Db,
} from '@plandesk/db';
import { readCliConfig } from './config.js';
import {
  buildConfigJson,
  normalizeServerUrl,
  readPlandeskConfig,
  readPlandeskToken,
  TOKEN_ENV_VAR,
} from './connect-artifacts.js';
import { resolveProjectId, SyncConfigError, type ResolvedSync } from './sync.js';

export type PushOptions = {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  globalProjectId?: string;
  syncToken?: string;
  /** When set, promote the local project into this hosted org (one-way). */
  toOrgId?: string;
};

export type PromotePushResult = {
  kind: 'promote';
  globalProjectId: string;
  orgId: string;
  serverUrl: string;
};

export class PromotePushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotePushError';
  }
}

/**
 * Token for promote: env PLANDESK_MCP_TOKEN > global ~/.plandesk/config.json
 * (plandesk login) > repo .plandesk/token. First non-empty wins.
 */
export function resolvePromoteToken(repoDir: string, home = homedir()): string {
  const fromEnv = process.env[TOKEN_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  const global = readCliConfig(home);
  if (global !== undefined && global.token.trim() !== '') {
    return global.token.trim();
  }
  const fromFile = readPlandeskToken(repoDir);
  if (fromFile !== undefined && fromFile.trim() !== '') {
    return fromFile.trim();
  }
  throw new SyncConfigError(
    `Token is required for promote. Set ${TOKEN_ENV_VAR}, run plandesk login, or write .plandesk/token.`,
  );
}

/**
 * Server for promote: --remote/--url flag > repo .plandesk/config.json serverUrl
 * > global ~/.plandesk/config.json server (from plandesk login).
 * Repo stays ahead of global so an already-connected repo keeps its binding.
 */
export function resolvePromoteServerUrl(
  repoDir: string,
  remoteUrl?: string,
  home = homedir(),
): string {
  if (remoteUrl !== undefined && remoteUrl.trim() !== '') {
    return normalizeServerUrl(remoteUrl);
  }
  const config = readPlandeskConfig(repoDir);
  if (config !== undefined && config.serverUrl.trim() !== '') {
    return normalizeServerUrl(config.serverUrl);
  }
  const global = readCliConfig(home);
  if (global !== undefined && global.server.trim() !== '') {
    return normalizeServerUrl(global.server);
  }
  if (config === undefined) {
    throw new SyncConfigError('Missing .plandesk/config.json. Run plandesk connect or plandesk login first.');
  }
  throw new SyncConfigError('serverUrl is required in .plandesk/config.json for promote.');
}

async function runPromotePush(db: Db, options: PushOptions & { toOrgId: string }): Promise<PromotePushResult> {
  const localProjectId = resolveProjectId({
    repoDir: options.repoDir,
    projectId: options.projectId,
  });
  const blob = await exportProject(db, localProjectId);
  if (blob === undefined) {
    throw new PromotePushError(`project not found: ${localProjectId}`);
  }

  const serverUrl = resolvePromoteServerUrl(options.repoDir, options.remoteUrl);
  const token = resolvePromoteToken(options.repoDir);
  const orgId = options.toOrgId.trim();
  if (orgId === '') {
    throw new PromotePushError('org id is required for --to');
  }

  const importUrl = `${serverUrl}/api/v1/orgs/${encodeURIComponent(orgId)}/import`;
  let response: Response;
  try {
    response = await fetch(importUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(blob),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromotePushError(`promote request failed: ${message}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === 'string') {
        detail = `: ${body.error}`;
      }
    } catch {
      // ignore non-JSON error bodies
    }
    throw new PromotePushError(
      `promote failed with HTTP ${String(response.status)}${detail}`,
    );
  }

  const payload = (await response.json()) as { globalProjectId?: string };
  if (typeof payload.globalProjectId !== 'string' || payload.globalProjectId.trim() === '') {
    throw new PromotePushError('promote response missing globalProjectId');
  }
  const globalProjectId = payload.globalProjectId;

  await setSyncRemote(db, localProjectId, {
    serverUrl,
    globalProjectId,
    syncToken: token,
  });

  // Sole record of hosted authority: repoint config (local rows are left alone).
  const configPath = join(options.repoDir, '.plandesk', 'config.json');
  const existing = readPlandeskConfig(options.repoDir);
  const projectName = existing?.projectName ?? blob.project.name;
  writeFileSync(
    configPath,
    buildConfigJson({
      serverUrl,
      orgId,
      projectId: globalProjectId,
      projectName,
    }),
    'utf8',
  );

  return {
    kind: 'promote',
    globalProjectId,
    orgId,
    serverUrl,
  };
}

export async function runPush(db: Db, options: PushOptions): Promise<PromotePushResult> {
  if (options.toOrgId === undefined) {
    throw new PromotePushError(
      'push requires --to <org-id>. The projection snapshot was retired; promote the project to a hosted org instead.',
    );
  }
  return runPromotePush(db, { ...options, toOrgId: options.toOrgId });
}

export function formatPushSummary(result: PromotePushResult): string {
  return `Promoted to org ${result.orgId} as ${result.globalProjectId} on ${result.serverUrl}.\n`;
}

export type { ResolvedSync };
