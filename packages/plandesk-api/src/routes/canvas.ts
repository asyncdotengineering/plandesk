import { Hono } from 'hono';
import { InvalidCanvasError, type CanvasService } from '../services/canvas.js';

export function createCanvasRouter(canvasService: CanvasService): Hono {
  const router = new Hono();

  router.get('/projects/:id/canvas', async (c) => {
    const canvas = await canvasService.get(c.req.param('id'));
    if (!canvas) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(canvas);
  });

  router.put('/projects/:id/canvas', async (c) => {
    const body = await c.req.json<{
      nodes?: unknown;
      edges?: unknown;
      layout?: unknown;
    }>();

    if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    for (const node of body.nodes) {
      if (
        typeof node !== 'object' ||
        node === null ||
        typeof (node as { x?: unknown }).x !== 'number' ||
        typeof (node as { y?: unknown }).y !== 'number'
      ) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
    }

    for (const edge of body.edges) {
      if (
        typeof edge !== 'object' ||
        edge === null ||
        typeof (edge as { from_task_id?: unknown }).from_task_id !== 'string' ||
        typeof (edge as { to_task_id?: unknown }).to_task_id !== 'string'
      ) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
    }

    try {
      const canvas = await canvasService.putLayout(c.req.param('id'), {
        nodes: body.nodes as Parameters<CanvasService['putLayout']>[1]['nodes'],
        edges: body.edges as Parameters<CanvasService['putLayout']>[1]['edges'],
        layout: body.layout,
      });

      if (!canvas) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(canvas);
    } catch (error) {
      if (error instanceof InvalidCanvasError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.delete('/projects/:id/edges/:edgeId', async (c) => {
    const deleted = await canvasService.deleteEdge(c.req.param('id'), c.req.param('edgeId'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
