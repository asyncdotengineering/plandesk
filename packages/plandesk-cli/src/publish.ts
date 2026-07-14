import type { Db } from '@plandesk/db';
import { ensureDefaultOrg } from '@plandesk/db';
import { createServices } from '@plandesk/api';
import { ensureSyncGitignore, resolvePublishInput, setConfigSync, writeSyncToken } from './sync.js';

export type PublishOptions = {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  syncToken?: string;
};

export type PublishResult = {
  projectId: string;
  serverUrl: string;
  globalProjectId: string;
  pushed: number;
};

export async function runPublish(db: Db, options: PublishOptions): Promise<PublishResult> {
  const input = resolvePublishInput(options);
  const org = await ensureDefaultOrg(db);
  const { syncService } = createServices({ db, orgId: org.id });
  const { globalProjectId, pushed } = await syncService.publishProject(input.projectId, {
    serverUrl: input.serverUrl,
    syncToken: input.syncToken,
  });

  setConfigSync(options.repoDir, {
    serverUrl: input.serverUrl,
    globalProjectId,
  });
  writeSyncToken(options.repoDir, input.syncToken);
  ensureSyncGitignore(options.repoDir);

  return {
    projectId: input.projectId,
    serverUrl: input.serverUrl,
    globalProjectId,
    pushed,
  };
}

export function formatPublishSummary(result: PublishResult): string {
  return `Published ${result.projectId} → ${result.serverUrl} (global ${result.globalProjectId}); pushed ${String(result.pushed)} share(s).\n`;
}
