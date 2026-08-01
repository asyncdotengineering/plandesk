import { Hono } from 'hono';
import { InvalidViewError, type ViewService } from '../services/views.js';

type CreateViewBody = {
  name?: string;
  config?: unknown;
  position?: number;
};

type UpdateViewBody = {
  name?: string;
  config?: unknown;
  position?: number;
};

export function createViewsRouter(viewService: ViewService): Hono {
  const router = new Hono();

  router.get('/projects/:id/views', async (c) => {
    const views = await viewService.list(c.req.param('id'));
    if (!views) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(views);
  });

  router.get('/views/:id', async (c) => {
    const view = await viewService.get(c.req.param('id'));
    if (!view) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(view);
  });

  router.post('/projects/:id/views', async (c) => {
    const body = await c.req.json<CreateViewBody>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.config === undefined) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.position !== undefined && typeof body.position !== 'number') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const view = await viewService.create(c.req.param('id'), {
        name: body.name,
        config: body.config,
        position: body.position,
      });
      if (!view) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(view, 201);
    } catch (error) {
      if (error instanceof InvalidViewError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
  });

  router.patch('/views/:id', async (c) => {
    const body = await c.req.json<UpdateViewBody>();
    if (body.position !== undefined && typeof body.position !== 'number') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const view = await viewService.update(c.req.param('id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      });
      if (!view) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(view);
    } catch (error) {
      if (error instanceof InvalidViewError) {
        return c.json({ error: 'invalid_argument', message: error.message }, 400);
      }
      throw error;
    }
  });

  router.delete('/views/:id', async (c) => {
    const deleted = await viewService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
