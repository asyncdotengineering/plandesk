import { Hono } from 'hono';
import { InvalidPrototypeError, type PrototypeService } from '../services/prototypes.js';

type CreatePrototypeBody = {
  name?: string;
  viewport_width?: number;
  viewport_height?: number;
};

type UpdatePrototypeBody = {
  name?: string;
  viewport_width?: number;
  viewport_height?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function createPrototypesRouter(prototypeService: PrototypeService): Hono {
  const router = new Hono();

  router.get('/projects/:id/prototypes', async (c) => {
    const prototypes = await prototypeService.list(c.req.param('id'));
    if (!prototypes) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(prototypes);
  });

  router.post('/projects/:id/prototypes', async (c) => {
    const body = await c.req.json<CreatePrototypeBody>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (!isFiniteNumber(body.viewport_width) || !isFiniteNumber(body.viewport_height)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const prototype = await prototypeService.create(c.req.param('id'), {
        name: body.name,
        viewportWidth: body.viewport_width,
        viewportHeight: body.viewport_height,
      });

      if (!prototype) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(prototype, 201);
    } catch (error) {
      if (error instanceof InvalidPrototypeError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/prototypes/:id', async (c) => {
    const prototype = await prototypeService.get(c.req.param('id'));
    if (!prototype) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(prototype);
  });

  router.patch('/prototypes/:id', async (c) => {
    const body = await c.req.json<UpdatePrototypeBody>();
    if (body.viewport_width !== undefined && !isFiniteNumber(body.viewport_width)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.viewport_height !== undefined && !isFiniteNumber(body.viewport_height)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const prototype = await prototypeService.update(c.req.param('id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.viewport_width !== undefined ? { viewportWidth: body.viewport_width } : {}),
        ...(body.viewport_height !== undefined ? { viewportHeight: body.viewport_height } : {}),
      });

      if (!prototype) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(prototype);
    } catch (error) {
      if (error instanceof InvalidPrototypeError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  return router;
}
