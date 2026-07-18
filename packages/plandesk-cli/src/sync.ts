import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SyncRemote } from '@plandesk/api';
import {
  appendGitignoreLine,
  buildConfigJson,
  getBoundProjectId,
  GITIGNORE_SYNC_TOKEN_LINE,
  normalizeServerUrl,
  parseConfigJson,
  SYNC_TOKEN_ENV_VAR,
  type AnyPlanDeskConfig,
} from './connect-artifacts.js';

export type ResolvedSync = {
  projectId: string;
  syncRemote: SyncRemote;
};

export class SyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncConfigError';
  }
}

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, 'utf8');
}

export function readSyncToken(repoDir: string): string | undefined {
  const fromEnv = process.env[SYNC_TOKEN_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  const tokenPath = join(repoDir, '.plandesk', 'sync-token');
  const existing = readOptionalFile(tokenPath)?.trim();
  if (existing !== undefined && existing !== '') {
    return existing;
  }
  return undefined;
}

export function writeSyncToken(repoDir: string, token: string): void {
  const tokenPath = join(repoDir, '.plandesk', 'sync-token');
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, `${token}\n`, 'utf8');
}

export function setConfigSync(
  repoDir: string,
  sync: { serverUrl: string; globalProjectId: string },
): void {
  const configPath = join(repoDir, '.plandesk', 'config.json');
  const existing = readOptionalFile(configPath);
  if (existing === undefined) {
    throw new SyncConfigError('Missing .plandesk/config.json. Run plandesk connect first.');
  }
  const config = parseConfigJson(existing);
  if (config.version === 'plandesk-connect-v2') {
    writeFileSync(
      configPath,
      buildConfigJson({
        serverUrl: config.serverUrl,
        projectId: config.projectIds[0] ?? '',
        projectName: config.workspaceName,
        sync: {
          serverUrl: normalizeServerUrl(sync.serverUrl),
          globalProjectId: sync.globalProjectId,
        },
      }),
      'utf8',
    );
    return;
  }
  writeFileSync(
    configPath,
    buildConfigJson({
      serverUrl: config.serverUrl,
      projectId: config.projectId,
      projectName: config.projectName,
      sync: {
        serverUrl: normalizeServerUrl(sync.serverUrl),
        globalProjectId: sync.globalProjectId,
      },
    }),
    'utf8',
  );
}

export function ensureSyncGitignore(repoDir: string): void {
  const gitignorePath = join(repoDir, '.gitignore');
  const content = appendGitignoreLine(readOptionalFile(gitignorePath), GITIGNORE_SYNC_TOKEN_LINE);
  writeFileSync(gitignorePath, content, 'utf8');
}

function loadConfig(repoDir: string): AnyPlanDeskConfig {
  const configPath = join(repoDir, '.plandesk', 'config.json');
  const content = readOptionalFile(configPath);
  if (content === undefined) {
    throw new SyncConfigError('Missing .plandesk/config.json. Run plandesk connect first.');
  }
  return parseConfigJson(content);
}

export function resolveProjectId(options: { repoDir: string; projectId?: string }): string {
  const projectId = options.projectId ?? getBoundProjectId(loadConfig(options.repoDir));
  if (projectId === undefined || projectId.trim() === '') {
    throw new SyncConfigError('Project id is required. Use --project or plandesk connect.');
  }
  return projectId;
}

export function resolveSyncRemote(options: {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  globalProjectId?: string;
  syncToken?: string;
}): ResolvedSync {
  const config = loadConfig(options.repoDir);

  const projectId = options.projectId ?? getBoundProjectId(config);
  if (projectId === undefined || projectId.trim() === '') {
    throw new SyncConfigError('Project id is required. Use --project or plandesk connect.');
  }

  const syncSection = config.sync;
  const serverUrl = options.remoteUrl ?? syncSection?.serverUrl;
  const globalProjectId = options.globalProjectId ?? syncSection?.globalProjectId;
  const syncToken = options.syncToken ?? readSyncToken(options.repoDir);

  if (serverUrl === undefined || serverUrl.trim() === '') {
    throw new SyncConfigError(
      'Sync server URL is required. Use publish --remote or set sync.serverUrl in config.',
    );
  }
  if (globalProjectId === undefined || globalProjectId.trim() === '') {
    throw new SyncConfigError(
      'Global project id is required. Run plandesk publish or set sync.globalProjectId in config.',
    );
  }
  if (syncToken === undefined || syncToken.trim() === '') {
    throw new SyncConfigError(
      `Sync token is required. Set ${SYNC_TOKEN_ENV_VAR}, write .plandesk/sync-token, or pass --sync-token.`,
    );
  }

  return {
    projectId,
    syncRemote: {
      serverUrl: normalizeServerUrl(serverUrl),
      globalProjectId,
      syncToken,
    },
  };
}

export function resolvePublishInput(options: {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  syncToken?: string;
}): { projectId: string; serverUrl: string; syncToken: string } {
  const config = loadConfig(options.repoDir);

  const projectId = options.projectId ?? getBoundProjectId(config);
  if (projectId === undefined || projectId.trim() === '') {
    throw new SyncConfigError('Project id is required. Use --project or plandesk connect.');
  }

  const serverUrl = options.remoteUrl;
  if (serverUrl === undefined || serverUrl.trim() === '') {
    throw new SyncConfigError('Remote URL is required. Use publish --remote <url>.');
  }

  const syncToken = options.syncToken ?? readSyncToken(options.repoDir);
  if (syncToken === undefined || syncToken.trim() === '') {
    throw new SyncConfigError(
      `Sync token is required. Set ${SYNC_TOKEN_ENV_VAR}, write .plandesk/sync-token, or pass --sync-token.`,
    );
  }

  return {
    projectId,
    serverUrl: normalizeServerUrl(serverUrl),
    syncToken,
  };
}
