import {
  getPullCursor,
  listSubmissions,
  setPullCursor,
  upsertSubmission,
  type Db,
  type ShareSubmission,
  type ShareSubmissionStatus,
} from '@plandesk/db';
import type { EventBus } from '../events.js';

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
};

export function createSyncService(deps: SyncServiceDeps) {
  const { db, eventBus } = deps;

  return {
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
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
