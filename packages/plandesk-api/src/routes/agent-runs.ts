import { Hono } from 'hono';
import type { AgentRunService } from '../services/agent-runs.js';
import { parsePaginationParams } from '../serialize.js';

export function createAgentRunsRouter(agentRunService: AgentRunService): Hono {
  const router = new Hono();

  router.get('/projects/:id/agent-runs', (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const runs = agentRunService.listForProject(c.req.param('id'), pagination);
    if (!runs) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(runs);
  });

  return router;
}
