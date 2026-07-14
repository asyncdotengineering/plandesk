import { Hono } from 'hono';
import { InvalidAgentRunError, type AgentRunService } from '../services/agent-runs.js';
import { parsePaginationParams } from '../serialize.js';

export function createAgentRunsRouter(agentRunService: AgentRunService): Hono {
  const router = new Hono();

  router.get('/projects/:id/agent-runs', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const runs = await agentRunService.listForProject(c.req.param('id'), pagination);
    if (!runs) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(runs);
  });

  router.post('/agent-runs/:id/progress', async (c) => {
    const body = await c.req.json<{ message?: string }>();
    if (typeof body.message !== 'string' || body.message.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const event = await agentRunService.recordProgress(c.req.param('id'), body.message);
      if (!event) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(event, 201);
    } catch (error) {
      if (error instanceof InvalidAgentRunError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  return router;
}
