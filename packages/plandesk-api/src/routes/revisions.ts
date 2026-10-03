import { invalidArgument, invalidRequest } from './errors.js';
import { Hono } from 'hono';
import type { RevisionService } from '../services/revisions.js';

export function createRevisionsRouter(revisionService: RevisionService): Hono {
  const router = new Hono();

  router.get('/projects/:projectId/revisions', async (c) => {
    const targetType = c.req.query('target_type');
    const targetId = c.req.query('target_id');
    if (targetType === undefined || targetId === undefined) {
      return invalidRequest(c, 'target_type and target_id query parameters are both required');
    }
    const revisions = await revisionService.list(c.req.param('projectId'), targetType, targetId);
    if (!revisions) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(revisions);
  });

  router.get('/revisions/:id', async (c) => {
    const revision = await revisionService.get(c.req.param('id'));
    if (!revision) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(revision);
  });

  router.get('/revisions/:id/diff', async (c) => {
    const against = c.req.query('against');
    if (against === undefined) {
      return invalidArgument(c, 'against', 'against query parameter is required');
    }
    const diffs = await revisionService.diff(c.req.param('id'), against);
    if (!diffs) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(diffs);
  });

  router.post('/revisions/:id/restore', async (c) => {
    const entity = await revisionService.restore(c.req.param('id'));
    if (!entity) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(entity);
  });

  return router;
}
