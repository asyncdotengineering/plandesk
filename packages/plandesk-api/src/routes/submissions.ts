import { Hono } from 'hono';
import { shareSubmissionStatuses, type ShareSubmissionStatus } from '@plandesk/db';
import {
  InvalidTriageError,
  SubmissionRetriageMismatchError,
  SyncUnauthorizedError,
  SyncUnavailableError,
  type SyncService,
} from '../services/sync.js';
import type { ProjectService } from '../services/projects.js';

type TriageBody = {
  action?: string;
  as_task?: { label?: string; description?: string };
  // Merge-into: link the submission to an existing task instead of creating a new one.
  // Mutually exclusive with as_task; forwarded to syncService.triage().
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

  router.get('/projects/:id/submissions', async (c) => {
    const projectId = c.req.param('id');
    if (!(await projectService.get(projectId))) {
      return c.json({ error: 'not_found' }, 404);
    }

    const statusParam = c.req.query('status') ?? 'pending';
    if (!isSubmissionStatus(statusParam)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    return c.json(await syncService.listTriage(projectId, statusParam));
  });

  router.post('/submissions/:id/triage', async (c) => {
    const submissionId = c.req.param('id');
    const body = await c.req.json<TriageBody>();

    if (body.action !== 'accept' && body.action !== 'reject') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const submission = await syncService.getSubmission(submissionId);
    if (submission === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    // Optional remote: single-server guest submit has no cross-server ack target.
    // Legacy local→remote pull still stores a remote when present.
    const remote = await syncService.getRemote(submission.project_id);

    try {
      // Triage never creates a `todo` task — the scope->todo release is the human's own
      // board action, enforced in syncService.triage(). A merge (link_task_id) links to
      // an existing task instead of creating one; the two are mutually exclusive, so
      // only one is forwarded.
      const linkTaskId = body.action === 'accept' ? body.link_task_id : undefined;
      const result = await syncService.triage(
        submissionId,
        body.action,
        remote,
        body.action === 'accept' && linkTaskId === undefined ? body.as_task : undefined,
        linkTaskId,
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof InvalidTriageError) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (error instanceof SubmissionRetriageMismatchError) {
        return c.json({ error: 'conflict' }, 409);
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
