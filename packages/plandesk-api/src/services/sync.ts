import {
  getSubmission as dbGetSubmission,
  listSubmissions,
  setSubmissionStatus,
  type Db,
  type ShareSubmission,
  type ShareSubmissionStatus,
} from '@plandesk/db';
import { assertPermission, resolveOrgId, type OrgScopedDeps } from './org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './scope.js';
import type { TaskService } from './tasks.js';

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

/** Thrown when a retry disagrees with an already-recorded triage outcome. Maps to HTTP 409. */
export class SubmissionRetriageMismatchError extends Error {
  constructor(message = 'submission already triaged with a different outcome') {
    super(message);
    this.name = 'SubmissionRetriageMismatchError';
  }
}

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

export function createSyncService(deps: SyncServiceDeps) {
  const { db, taskService } = deps;

  return {
    async listTriage(
      projectId: string,
      status?: ShareSubmissionStatus,
    ): Promise<SerializedSubmission[] | undefined> {
      try {
        await assertProjectInOrg(db, projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          return undefined;
        }
        throw error;
      }
      return (await listSubmissions(db, projectId, status)).map(serializeSubmission);
    },

    async getSubmission(submissionId: string): Promise<SerializedSubmission | undefined> {
      const submission = await dbGetSubmission(db, submissionId);
      return submission === undefined ? undefined : serializeSubmission(submission);
    },

    async triage(
      submissionId: string,
      action: 'accept' | 'reject',
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

      // Workspace/org chokepoint: the submission's project must be in the
      // caller's scope before any triage mutation (cross-workspace/org → 404).
      try {
        await assertProjectInOrg(db, submission.projectId, resolveOrgId(deps));
      } catch (error) {
        if (error instanceof ProjectNotInOrgError) {
          throw new InvalidTriageError();
        }
        throw error;
      }

      if (submission.status !== 'pending') {
        // Corrected retry: same action + same link stays idempotent. Disagreement —
        // different link, as_task (create-new) against an already-linked accept, or
        // a reversed action — is a conflict; first-write-wins must not silently no-op.
        if (
          (action === 'accept' && submission.status === 'rejected') ||
          (action === 'reject' && submission.status === 'accepted') ||
          (action === 'accept' && submission.status === 'accepted' && asTask !== undefined) ||
          (action === 'accept' &&
            submission.status === 'accepted' &&
            linkTaskId !== undefined &&
            linkTaskId !== submission.linkedTaskId)
        ) {
          throw new SubmissionRetriageMismatchError();
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
          throw new SubmissionRetriageMismatchError();
        }

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
          throw new SubmissionRetriageMismatchError();
        }

        return serializeSubmission(updated);
      }

      const updated = await setSubmissionStatus(db, submissionId, { status: 'rejected' });
      if (updated === undefined) {
        throw new SubmissionRetriageMismatchError();
      }

      return serializeSubmission(updated);
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
