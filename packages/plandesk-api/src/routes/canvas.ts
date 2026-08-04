import { invalidRequest } from './errors.js';
import { Hono } from 'hono';
import type { LinkEntityType } from '@plandesk/db';
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
      return invalidRequest(c, 'nodes and edges must both be arrays');
    }

    for (const node of body.nodes) {
      if (
        typeof node !== 'object' ||
        node === null ||
        typeof (node as { x?: unknown }).x !== 'number' ||
        typeof (node as { y?: unknown }).y !== 'number'
      ) {
        return invalidRequest(c, 'each node must be an object with numeric x and y');
      }
    }

    for (const edge of body.edges) {
      if (
        typeof edge !== 'object' ||
        edge === null ||
        typeof (edge as { from_task_id?: unknown }).from_task_id !== 'string' ||
        typeof (edge as { to_task_id?: unknown }).to_task_id !== 'string'
      ) {
        return invalidRequest(c, 'each edge must be an object with string from_task_id and to_task_id');
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
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/projects/:id/edges', async (c) => {
    const edges = await canvasService.listEdges(c.req.param('id'));
    if (!edges) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(edges);
  });

  router.post('/projects/:id/edges', async (c) => {
    const body = await c.req.json<{
      from_type?: string;
      from_id?: string;
      to_type?: string;
      to_id?: string;
      from_task_id?: string;
      to_task_id?: string;
      label?: string | null;
      style?: string | null;
      arrow_direction?: string | null;
    }>();

    try {
      const edge = await canvasService.createEdge(c.req.param('id'), {
        ...(body.from_type !== undefined ? { fromType: body.from_type as LinkEntityType } : {}),
        ...(body.from_id !== undefined ? { fromId: body.from_id } : {}),
        ...(body.to_type !== undefined ? { toType: body.to_type as LinkEntityType } : {}),
        ...(body.to_id !== undefined ? { toId: body.to_id } : {}),
        ...(body.from_task_id !== undefined ? { fromTaskId: body.from_task_id } : {}),
        ...(body.to_task_id !== undefined ? { toTaskId: body.to_task_id } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.style !== undefined ? { style: body.style } : {}),
        ...(body.arrow_direction !== undefined ? { arrowDirection: body.arrow_direction } : {}),
      });

      if (!edge) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(edge, 201);
    } catch (error) {
      if (error instanceof InvalidCanvasError) {
        return invalidRequest(c, error.message);
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
