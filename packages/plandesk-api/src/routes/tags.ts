import { Hono } from 'hono';
import { InvalidTagError, type TagService } from '../services/tags.js';

type CreateTagBody = {
  name?: string;
  color?: string | null;
};

type UpdateTagBody = {
  name?: string;
  color?: string | null;
};

export function createTagsRouter(tagService: TagService): Hono {
  const router = new Hono();

  router.get('/projects/:id/tags', (c) => {
    const tags = tagService.list(c.req.param('id'));
    if (!tags) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(tags);
  });

  router.post('/projects/:id/tags', async (c) => {
    const body = await c.req.json<CreateTagBody>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const tag = tagService.create(c.req.param('id'), {
        name: body.name,
        color: body.color,
      });

      if (!tag) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(tag, 201);
    } catch (error) {
      if (error instanceof InvalidTagError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.patch('/tags/:id', async (c) => {
    const body = await c.req.json<UpdateTagBody>();

    try {
      const tag = tagService.update(c.req.param('id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      });

      if (!tag) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(tag);
    } catch (error) {
      if (error instanceof InvalidTagError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.delete('/tags/:id', (c) => {
    const deleted = tagService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
