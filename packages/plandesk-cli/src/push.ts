import type { Db } from '@plandesk/db';
import { createServices } from '@plandesk/api';
import { resolveSyncRemote, type ResolvedSync } from './sync.js';

export type PushOptions = {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  globalProjectId?: string;
  syncToken?: string;
};

export type PushResult = {
  pushed: number;
};

export async function runPush(db: Db, options: PushOptions): Promise<PushResult> {
  const resolved = resolveSyncRemote(options);
  const { syncService } = createServices({ db });
  return syncService.push(resolved.projectId, resolved.syncRemote);
}

export function formatPushSummary(result: PushResult): string {
  return `Pushed ${String(result.pushed)} share(s).\n`;
}

export type { ResolvedSync };
