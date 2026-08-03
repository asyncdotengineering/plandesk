import { Hono } from 'hono';
import type { SearchService } from '../services/search.js';

export function createSearchRouter(searchService: SearchService): Hono {
  const router = new Hono();

  router.get('/search', async (c) => {
    const query = c.req.query('q') ?? '';
    const projectId = c.req.query('project_id');
    const workspaceId = c.req.query('workspace_id') ?? c.req.header('x-plandesk-workspace-id');
    const limitRaw = c.req.query('limit');
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    if (limitRaw !== undefined && (Number.isNaN(limit) || limit === undefined)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const result = await searchService.search({
      query,
      ...(projectId !== undefined && projectId !== '' ? { projectId } : {}),
      ...(workspaceId !== undefined && workspaceId.trim() !== ''
        ? { workspaceId: workspaceId.trim() }
        : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json(result);
  });

  return router;
}
