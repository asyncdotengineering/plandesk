import { invalidArgument, invalidRequest, notFound } from './errors.js';
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

  router.get('/projects/:id/tags', async (c) => {
    const tags = await tagService.list(c.req.param('id'));
    if (!tags) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(tags);
  });

  router.post('/projects/:id/tags', async (c) => {
    const body = await c.req.json<CreateTagBody>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return invalidArgument(c, 'name', 'name is required and must be a non-empty string');
    }

    try {
      const tag = await tagService.create(c.req.param('id'), {
        name: body.name,
        color: body.color,
      });

      if (!tag) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(tag, 201);
    } catch (error) {
      if (error instanceof InvalidTagError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/tags/:id', async (c) => {
    const id = c.req.param('id');
    const tag = await tagService.get(id);
    if (!tag) {
      return notFound(c, 'tag', id);
    }
    return c.json(tag);
  });

  router.patch('/tags/:id', async (c) => {
    const body = await c.req.json<UpdateTagBody>();

    try {
      const tag = await tagService.update(c.req.param('id'), {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      });

      if (!tag) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(tag);
    } catch (error) {
      if (error instanceof InvalidTagError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.delete('/tags/:id', async (c) => {
    const deleted = await tagService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
