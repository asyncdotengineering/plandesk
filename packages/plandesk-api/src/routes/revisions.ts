import { Hono } from 'hono';
import {
  InvalidRevisionQueryError,
  type RevisionService,
} from '../services/revisions.js';

export function createRevisionsRouter(revisionService: RevisionService): Hono {
  const router = new Hono();

  router.get('/projects/:projectId/revisions', async (c) => {
    const targetType = c.req.query('target_type');
    const targetId = c.req.query('target_id');
    if (targetType === undefined || targetId === undefined) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    try {
      const revisions = await revisionService.list(c.req.param('projectId'), targetType, targetId);
      if (!revisions) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(revisions);
    } catch (error) {
      if (error instanceof InvalidRevisionQueryError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
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
      return c.json({ error: 'invalid_argument' }, 400);
    }
    try {
      const diffs = await revisionService.diff(c.req.param('id'), against);
      if (!diffs) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(diffs);
    } catch (error) {
      if (error instanceof InvalidRevisionQueryError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
  });

  return router;
}
