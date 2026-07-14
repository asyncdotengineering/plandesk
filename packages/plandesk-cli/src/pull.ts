import type { Db } from '@plandesk/db';
import { createServices } from '@plandesk/api';
import { resolveSyncRemote } from './sync.js';

export type PullOptions = {
  repoDir: string;
  projectId?: string;
  remoteUrl?: string;
  globalProjectId?: string;
  syncToken?: string;
};

export type PullResult = {
  pulled: number;
  pending: number;
};

export async function runPull(db: Db, options: PullOptions): Promise<PullResult> {
  const resolved = resolveSyncRemote(options);
  const { syncService } = createServices({ db });
  const { pulled } = await syncService.pull(resolved.projectId, resolved.syncRemote);
  const pending = (await syncService.listTriage(resolved.projectId, 'pending')).length;
  return { pulled, pending };
}

export function formatPullSummary(result: PullResult): string {
  return `Pulled ${String(result.pulled)} submission(s). ${String(result.pending)} pending in triage.\n`;
}
