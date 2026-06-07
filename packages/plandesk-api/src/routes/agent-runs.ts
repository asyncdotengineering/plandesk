import { Hono } from 'hono';
import type { AgentRunService } from '../services/agent-runs.js';

export function createAgentRunsRouter(agentRunService: AgentRunService): Hono {
  const router = new Hono();

  router.get('/projects/:id/agent-runs', (c) => {
    const runs = agentRunService.listForProject(c.req.param('id'));
    if (!runs) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(runs);
  });

  return router;
}
