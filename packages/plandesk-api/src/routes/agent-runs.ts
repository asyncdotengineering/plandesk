import { invalidArgument, invalidRequest, notFound } from './errors.js';
import { Hono } from 'hono';
import { InvalidAgentRunError, type AgentRunService } from '../services/agent-runs.js';
import { parsePaginationParams } from '../serialize.js';

export function createAgentRunsRouter(agentRunService: AgentRunService): Hono {
  const router = new Hono();

  router.get('/projects/:id/agent-runs', async (c) => {
    const pagination = parsePaginationParams(c.req.query('limit'), c.req.query('offset'));
    if (pagination === 'invalid') {
      return invalidRequest(c, 'limit and offset must be non-negative integers');
    }
    const runs = await agentRunService.listForProject(c.req.param('id'), pagination);
    if (!runs) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(runs);
  });

  router.post('/projects/:id/agent-runs', async (c) => {
    // A run may be opened with no body at all, so an unparsable body is an
    // absent label rather than a client error.
    const body: { label?: unknown } = await c.req.json<{ label?: unknown }>().catch(() => ({}));
    if (body.label !== undefined && body.label !== null && typeof body.label !== 'string') {
      return invalidArgument(c, 'label', 'label must be a string when present');
    }

    const run = await agentRunService.start(c.req.param('id'), body.label ?? null);
    if (!run) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(run, 201);
  });

  router.get('/agent-runs/:id', async (c) => {
    const id = c.req.param('id');
    const run = await agentRunService.get(id);
    if (!run) {
      return notFound(c, 'agent_run', id);
    }
    return c.json(run);
  });

  router.patch('/agent-runs/:id', async (c) => {
    const body: { status?: unknown } = await c.req.json<{ status?: unknown }>().catch(() => ({}));
    if (body.status !== 'completed' && body.status !== 'failed') {
      return invalidArgument(c, 'status', "status must be 'completed' or 'failed'");
    }

    try {
      const run = await agentRunService.complete(c.req.param('id'), body.status);
      if (!run) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(run);
    } catch (error) {
      if (error instanceof InvalidAgentRunError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.post('/agent-runs/:id/progress', async (c) => {
    const body = await c.req.json<{ message?: string }>();
    if (typeof body.message !== 'string' || body.message.trim() === '') {
      return invalidArgument(c, 'message', 'message is required and must be a non-empty string');
    }

    try {
      const event = await agentRunService.recordProgress(c.req.param('id'), body.message);
      if (!event) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(event, 201);
    } catch (error) {
      if (error instanceof InvalidAgentRunError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  return router;
}
