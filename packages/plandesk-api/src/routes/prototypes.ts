import { invalidArgument, invalidRequest } from './errors.js';
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
      return invalidArgument(c, 'name', 'name is required and must be a non-empty string');
    }
    // Split deliberately: a caller who sent a bad viewport_height must be told
    // that, not that "viewport_width" is wrong. Naming the wrong field is worse
    // than naming none.
    if (!isFiniteNumber(body.viewport_width)) {
      return invalidArgument(c, 'viewport_width', 'viewport_width must be a finite number');
    }
    if (!isFiniteNumber(body.viewport_height)) {
      return invalidArgument(c, 'viewport_height', 'viewport_height must be a finite number');
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
        return invalidRequest(c, error.message);
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
      return invalidArgument(c, 'viewport_width', 'viewport_width must be a finite number');
    }
    if (body.viewport_height !== undefined && !isFiniteNumber(body.viewport_height)) {
      return invalidArgument(c, 'viewport_height', 'viewport_height must be a finite number');
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
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  return router;
}
