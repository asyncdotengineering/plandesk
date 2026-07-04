import { randomUUID } from 'node:crypto';
import {
  getPullCursor,
  getShare,
  getSubmission as dbGetSubmission,
  getSyncRemote,
  listSubmissions,
  parseSharePermissions,
  setPullCursor,
  setSubmissionStatus,
  setSyncRemote,
  upsertSubmission,
  type Db,
  type Share,
  type ShareSubmission,
  type ShareSubmissionStatus,
  type TaskStatus,
} from '@plandesk/db';
import type { EventBus } from '../events.js';
import type { ShareService } from './share.js';
import type { TaskService } from './tasks.js';

export class SyncUnavailableError extends Error {
  constructor(message = 'sync server unavailable') {
    super(message);
    this.name = 'SyncUnavailableError';
  }
}

export class SyncUnauthorizedError extends Error {
  constructor(message = 'sync token unauthorized') {
    super(message);
    this.name = 'SyncUnauthorizedError';
  }
}

export class InvalidTriageError extends Error {
  constructor(message = 'submission not found') {
    super(message);
    this.name = 'InvalidTriageError';
  }
}

export class InvalidTriageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTriageInputError';
  }
}

export type SyncRemote = {
  serverUrl: string;
  globalProjectId: string;
  syncToken: string;
};

export type SerializedSubmission = {
  id: string;
  project_id: string;
  hosted_share_id: string;
  participant_name: string;
  title: string;
  body: string | null;
  severity: string | null;
  task_ref: string | null;
  status: ShareSubmissionStatus;
  linked_task_id: string | null;
  created_at: string;
  pulled_at: string;
};

type RemoteSubmission = {
  id: string;
  share_id: string;
  participant: { id: string; name: string };
  title: string;
  body: string | null;
  severity: string | null;
  task_ref: string | null;
  status: string;
  created_at: string;
};

export function serializeSubmission(row: ShareSubmission): SerializedSubmission {
  return {
    id: row.id,
    project_id: row.projectId,
    hosted_share_id: row.hostedShareId,
    participant_name: row.participantName,
    title: row.title,
    body: row.body,
    severity: row.severity,
    task_ref: row.taskRef,
    status: row.status,
    linked_task_id: row.linkedTaskId,
    created_at: row.createdAt.toISOString(),
    pulled_at: row.pulledAt.toISOString(),
  };
}

export type SyncServiceDeps = {
  db: Db;
  eventBus: EventBus;
  taskService: TaskService;
  shareService: ShareService;
};

export type WatchPushController = {
  onChange(): void;
  dispose(): void;
};

export type WatchPushOptions = {
  debounceMs?: number;
  onPushError?: (err: unknown) => void;
};

function parseInvitedEmails(raw: string | null): string[] {
  if (raw === null || raw === '') {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value): value is string => typeof value === 'string');
}

function buildDesc(submission: ShareSubmission): string | null {
  const footer = `Reported by ${submission.participantName} (client) via Plan Desk`;
  if (submission.body === null || submission.body === '') {
    return footer;
  }
  return `${submission.body}\n\n${footer}`;
}

async function ackSubmission(
  remote: SyncRemote,
  submissionId: string,
  status: string,
): Promise<void> {
  const base = remote.serverUrl.replace(/\/$/, '');
  const url = `${base}/api/sync/v1/projects/${encodeURIComponent(remote.globalProjectId)}/submissions/${encodeURIComponent(submissionId)}/ack`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${remote.syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });
  } catch {
    throw new SyncUnavailableError();
  }

  if (!response.ok) {
    throw new SyncUnavailableError(`sync server returned ${String(response.status)}`);
  }
}

async function pushProjection(remote: SyncRemote, share: Share, view: unknown): Promise<void> {
  const base = remote.serverUrl.replace(/\/$/, '');
  const url = `${base}/api/sync/v1/projects/${encodeURIComponent(remote.globalProjectId)}/projection`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${remote.syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        share: {
          token_hash: share.tokenHash,
          audience_name: share.audienceName,
          permissions: parseSharePermissions(share),
          mode: share.mode,
          invited_emails: parseInvitedEmails(share.invitedEmails),
          expires_at: share.expiresAt?.toISOString() ?? null,
        },
        version: Date.now(),
        view,
      }),
    });
  } catch {
    throw new SyncUnavailableError();
  }

  if (response.status === 401) {
    throw new SyncUnauthorizedError();
  }
  if (!response.ok) {
    throw new SyncUnavailableError(`sync server returned ${String(response.status)}`);
  }
}

function createWatchPush(
  push: (projectId: string, remote: SyncRemote) => Promise<{ pushed: number }>,
  projectId: string,
  remote: SyncRemote,
  opts?: WatchPushOptions,
): WatchPushController {
  const debounceMs = opts?.debounceMs ?? 1500;
  const onPushError =
    opts?.onPushError ??
    ((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`sync watch push failed: ${message}`);
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const runPush = () => {
    timer = undefined;
    void push(projectId, remote).catch(onPushError);
  };

  return {
    onChange() {
      if (disposed) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(runPush, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

export function createSyncService(deps: SyncServiceDeps) {
  const { db, eventBus, taskService, shareService } = deps;

  return {
    async push(projectId: string, remote: SyncRemote): Promise<{ pushed: number }> {
      const shares = shareService.listShares(projectId);
      if (shares === undefined) {
        throw new SyncUnavailableError('project not found');
      }

      const active = shares.filter((share) => share.revoked_at === null);
      let pushed = 0;

      for (const serialized of active) {
        const shareRow = getShare(db, serialized.id);
        if (shareRow === undefined) {
          continue;
        }

        const view = shareService.buildClientView(projectId, serialized.id);
        if (view === undefined) {
          continue;
        }

        await pushProjection(remote, shareRow, view);
        pushed += 1;
      }

      return { pushed };
    },

    async publishProject(
      projectId: string,
      input: { serverUrl: string; syncToken: string },
    ): Promise<{ globalProjectId: string; pushed: number }> {
      const globalProjectId = randomUUID();
      const { pushed } = await this.push(projectId, {
        serverUrl: input.serverUrl,
        globalProjectId,
        syncToken: input.syncToken,
      });
      return { globalProjectId, pushed };
    },

    async pull(projectId: string, remote: SyncRemote): Promise<{ pulled: number }> {
      const cursor = getPullCursor(db, projectId);
      const base = remote.serverUrl.replace(/\/$/, '');
      const url = new URL(
        `${base}/api/sync/v1/projects/${encodeURIComponent(remote.globalProjectId)}/submissions`,
      );
      if (cursor !== undefined) {
        url.searchParams.set('since', cursor);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${remote.syncToken}` },
        });
      } catch {
        throw new SyncUnavailableError();
      }

      if (response.status === 401) {
        throw new SyncUnauthorizedError();
      }
      if (!response.ok) {
        throw new SyncUnavailableError(`sync server returned ${String(response.status)}`);
      }

      const remoteSubmissions = (await response.json()) as RemoteSubmission[];
      const now = new Date();
      let pulled = 0;
      let maxCreatedAt = cursor;

      for (const submission of remoteSubmissions) {
        const inserted = upsertSubmission(db, {
          id: submission.id,
          projectId,
          hostedShareId: submission.share_id,
          participantName: submission.participant.name,
          title: submission.title,
          body: submission.body,
          severity: submission.severity,
          taskRef: submission.task_ref,
          status: 'pending',
          createdAt: new Date(submission.created_at),
          pulledAt: now,
        });
        if (inserted) {
          pulled += 1;
        }
        if (maxCreatedAt === undefined || submission.created_at > maxCreatedAt) {
          maxCreatedAt = submission.created_at;
        }
      }

      if (maxCreatedAt !== undefined && maxCreatedAt !== cursor) {
        setPullCursor(db, projectId, maxCreatedAt);
      }

      if (pulled > 0) {
        eventBus.emit({ type: 'submissions_pulled', projectId });
      }

      return { pulled };
    },

    listTriage(projectId: string, status?: ShareSubmissionStatus): SerializedSubmission[] {
      return listSubmissions(db, projectId, status).map(serializeSubmission);
    },

    getSubmission(submissionId: string): SerializedSubmission | undefined {
      const submission = dbGetSubmission(db, submissionId);
      return submission === undefined ? undefined : serializeSubmission(submission);
    },

    setRemote(projectId: string, remote: SyncRemote): void {
      setSyncRemote(db, projectId, {
        serverUrl: remote.serverUrl,
        globalProjectId: remote.globalProjectId,
        syncToken: remote.syncToken,
      });
    },

    getRemote(projectId: string): SyncRemote | undefined {
      const row = getSyncRemote(db, projectId);
      if (row === undefined) {
        return undefined;
      }
      return {
        serverUrl: row.serverUrl,
        globalProjectId: row.globalProjectId,
        syncToken: row.syncToken,
      };
    },

    async triage(
      submissionId: string,
      action: 'accept' | 'reject',
      remote: SyncRemote,
      asTask?: { label?: string; status?: TaskStatus; description?: string },
      linkTaskId?: string,
    ): Promise<SerializedSubmission> {
      if (asTask !== undefined && linkTaskId !== undefined) {
        throw new InvalidTriageInputError('as_task and link_task_id are mutually exclusive');
      }

      const submission = dbGetSubmission(db, submissionId);
      if (submission === undefined) {
        throw new InvalidTriageError();
      }

      if (submission.status !== 'pending') {
        return serializeSubmission(submission);
      }

      const projectId = submission.projectId;

      if (action === 'accept' && linkTaskId !== undefined) {
        const existingTask = taskService.get(linkTaskId);
        if (existingTask === undefined || existingTask.project_id !== projectId) {
          throw new InvalidTriageInputError(
            'link_task_id does not reference an existing task in this project',
          );
        }

        const updated = setSubmissionStatus(db, submissionId, {
          status: 'accepted',
          linkedTaskId: linkTaskId,
        });
        if (updated === undefined) {
          throw new InvalidTriageError();
        }

        eventBus.emit({ type: 'submissions_pulled', projectId });
        await ackSubmission(remote, submissionId, 'accepted');
        return serializeSubmission(updated);
      }

      if (action === 'accept') {
        const task = taskService.create(projectId, {
          label: asTask?.label ?? submission.title,
          status: asTask?.status ?? 'todo',
          description: asTask?.description ?? buildDesc(submission),
        });
        if (task === undefined) {
          throw new InvalidTriageError('project not found');
        }

        const updated = setSubmissionStatus(db, submissionId, {
          status: 'accepted',
          linkedTaskId: task.id,
        });
        if (updated === undefined) {
          throw new InvalidTriageError();
        }

        eventBus.emit({ type: 'submissions_pulled', projectId });
        await ackSubmission(remote, submissionId, 'accepted');
        return serializeSubmission(updated);
      }

      const updated = setSubmissionStatus(db, submissionId, { status: 'rejected' });
      if (updated === undefined) {
        throw new InvalidTriageError();
      }

      eventBus.emit({ type: 'submissions_pulled', projectId });
      await ackSubmission(remote, submissionId, 'rejected');
      return serializeSubmission(updated);
    },

    watchPush(projectId: string, remote: SyncRemote, opts?: WatchPushOptions): WatchPushController {
      return createWatchPush((id, rem) => this.push(id, rem), projectId, remote, opts);
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
