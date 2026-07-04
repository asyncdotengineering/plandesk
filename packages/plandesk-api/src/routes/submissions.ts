import { Hono } from 'hono';
import { shareSubmissionStatuses, type ShareSubmissionStatus } from '@plandesk/db';
import {
  InvalidTriageError,
  SyncUnauthorizedError,
  SyncUnavailableError,
  type SyncService,
} from '../services/sync.js';
import type { ProjectService } from '../services/projects.js';

type TriageBody = {
  action?: string;
  as_task?: { label?: string; description?: string };
  // Reserved for merge-into (linking the submission to an existing task instead of
  // creating a new one). syncService.triage() does not support linking yet — that
  // lands with the Curator's merge-accept work. Until then this is accepted on the
  // wire (so callers don't need to change) but not forwarded, and accept behaves the
  // same as a plain accept (creates a new `scope` task).
  link_task_id?: string;
};

function isSubmissionStatus(value: string): value is ShareSubmissionStatus {
  return (shareSubmissionStatuses as readonly string[]).includes(value);
}

export function createSubmissionsRouter(
  syncService: SyncService,
  projectService: ProjectService,
): Hono {
  const router = new Hono();

  router.get('/projects/:id/submissions', (c) => {
    const projectId = c.req.param('id');
    if (!projectService.get(projectId)) {
      return c.json({ error: 'not_found' }, 404);
    }

    const statusParam = c.req.query('status') ?? 'pending';
    if (!isSubmissionStatus(statusParam)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    return c.json(syncService.listTriage(projectId, statusParam));
  });

  router.post('/submissions/:id/triage', async (c) => {
    const submissionId = c.req.param('id');
    const body = await c.req.json<TriageBody>();

    if (body.action !== 'accept' && body.action !== 'reject') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const submission = syncService.getSubmission(submissionId);
    if (submission === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    const remote = syncService.getRemote(submission.project_id);
    if (remote === undefined) {
      return c.json({ error: 'not_published' }, 400);
    }

    try {
      // Accepting from this dashboard never creates a `todo` task — the human-only
      // scope -> todo release is structural policy, so the status is always forced
      // to `scope` regardless of what the caller sent.
      const result = await syncService.triage(
        submissionId,
        body.action,
        remote,
        body.action === 'accept' ? { ...body.as_task, status: 'scope' } : undefined,
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof InvalidTriageError) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (error instanceof SyncUnauthorizedError) {
        return c.json({ error: 'sync_unauthorized' }, 400);
      }
      if (error instanceof SyncUnavailableError) {
        return c.json({ error: 'sync_unavailable' }, 502);
      }
      throw error;
    }
  });

  return router;
}
