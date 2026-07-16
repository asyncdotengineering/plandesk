import {
  getPullCursor,
  getSubmission as dbGetSubmission,
  getSyncRemote,
  listSubmissions,
  setPullCursor,
  setSubmissionStatus,
  setSyncRemote,
  upsertSubmission,
  type Db,
  type ShareSubmission,
  type ShareSubmissionStatus,
} from '@plandesk/db';
import { assertPermission, type OrgScopedDeps } from './org-scope.js';
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

export type SyncServiceDeps = OrgScopedDeps & {
  db: Db;
  taskService: TaskService;
};

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

export function createSyncService(deps: SyncServiceDeps) {
  const { db, taskService } = deps;

  return {
    async pull(projectId: string, remote: SyncRemote): Promise<{ pulled: number }> {
      assertPermission(deps, 'task', 'update');
      const cursor = await getPullCursor(db, projectId);
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
        const inserted = await upsertSubmission(db, {
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
        await setPullCursor(db, projectId, maxCreatedAt);
      }

      if (pulled > 0) {
      }

      return { pulled };
    },

    async listTriage(
      projectId: string,
      status?: ShareSubmissionStatus,
    ): Promise<SerializedSubmission[]> {
      return (await listSubmissions(db, projectId, status)).map(serializeSubmission);
    },

    async getSubmission(submissionId: string): Promise<SerializedSubmission | undefined> {
      const submission = await dbGetSubmission(db, submissionId);
      return submission === undefined ? undefined : serializeSubmission(submission);
    },

    async setRemote(projectId: string, remote: SyncRemote): Promise<void> {
      assertPermission(deps, 'task', 'update');
      await setSyncRemote(db, projectId, {
        serverUrl: remote.serverUrl,
        globalProjectId: remote.globalProjectId,
        syncToken: remote.syncToken,
      });
    },

    async getRemote(projectId: string): Promise<SyncRemote | undefined> {
      const row = await getSyncRemote(db, projectId);
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
      asTask?: { label?: string; description?: string },
      linkTaskId?: string,
    ): Promise<SerializedSubmission> {
      assertPermission(deps, 'task', 'create');
      if (asTask !== undefined && linkTaskId !== undefined) {
        throw new InvalidTriageInputError('as_task and link_task_id are mutually exclusive');
      }

      const submission = await dbGetSubmission(db, submissionId);
      if (submission === undefined) {
        throw new InvalidTriageError();
      }

      if (submission.status !== 'pending') {
        // Idempotent retry recovery: a prior triage may have committed the terminal
        // status locally but failed to ack the remote (sync server briefly down),
        // leaving local/remote divergence with no recovery path. Re-ack when the
        // retry's action matches the recorded outcome; ack is idempotent remotely.
        if (
          (action === 'accept' && submission.status === 'accepted') ||
          (action === 'reject' && submission.status === 'rejected')
        ) {
          await ackSubmission(remote, submissionId, submission.status);
        }
        return serializeSubmission(submission);
      }

      const projectId = submission.projectId;

      if (action === 'accept' && linkTaskId !== undefined) {
        const existingTask = await taskService.get(linkTaskId);
        if (existingTask === undefined || existingTask.project_id !== projectId) {
          throw new InvalidTriageInputError(
            'link_task_id does not reference an existing task in this project',
          );
        }

        const updated = await setSubmissionStatus(db, submissionId, {
          status: 'accepted',
          linkedTaskId: linkTaskId,
        });
        if (updated === undefined) {
          throw new InvalidTriageError();
        }

        await ackSubmission(remote, submissionId, 'accepted');
        return serializeSubmission(updated);
      }

      if (action === 'accept') {
        // Triage never releases work to `todo`: the scope->todo gate is the human's
        // own board action. Every accepted submission lands in `scope`, regardless of
        // caller — enforced here at the single service chokepoint so both the HTTP
        // route and the MCP tool are covered.
        //
        // create + setSubmissionStatus run as two sequential steps after validating
        // the submission exists. taskService.create self-transacts, so an outer
        // transaction here is neither possible nor needed.
        const task = await taskService.create(projectId, {
          label: asTask?.label ?? submission.title,
          status: 'scope',
          description: asTask?.description ?? buildDesc(submission),
        });
        if (task === undefined) {
          throw new InvalidTriageError('project not found');
        }

        const updated = await setSubmissionStatus(db, submissionId, {
          status: 'accepted',
          linkedTaskId: task.id,
        });
        if (updated === undefined) {
          throw new InvalidTriageError();
        }

        await ackSubmission(remote, submissionId, 'accepted');
        return serializeSubmission(updated);
      }

      const updated = await setSubmissionStatus(db, submissionId, { status: 'rejected' });
      if (updated === undefined) {
        throw new InvalidTriageError();
      }

      await ackSubmission(remote, submissionId, 'rejected');
      return serializeSubmission(updated);
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
