import { Hono } from 'hono';
import { InvalidCommentError, type CommentService } from '../services/comments.js';

type CreateCommentBody = {
  body?: string;
  passage?: string | null;
};

type UpdateCommentBody = {
  body?: string;
  resolved?: boolean;
};

function parseIncludeResolved(value: string | undefined): boolean {
  return value === 'true';
}

export function createCommentsRouter(commentService: CommentService): Hono {
  const router = new Hono();

  router.post('/documents/:id/comments', async (c) => {
    const body = await c.req.json<CreateCommentBody>();
    if (typeof body.body !== 'string') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const comment = commentService.create(c.req.param('id'), {
        body: body.body,
        passage: body.passage,
      });

      if (!comment) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(comment, 201);
    } catch (error) {
      if (error instanceof InvalidCommentError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/documents/:id/comments', (c) => {
    const includeResolved = parseIncludeResolved(c.req.query('include_resolved'));
    const comments = commentService.listByDocument(c.req.param('id'), { includeResolved });
    if (!comments) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(comments);
  });

  router.get('/projects/:id/comments', (c) => {
    const includeResolved = parseIncludeResolved(c.req.query('include_resolved'));
    const comments = commentService.listByProject(c.req.param('id'), { includeResolved });
    if (!comments) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(comments);
  });

  router.patch('/comments/:id', async (c) => {
    const body = await c.req.json<UpdateCommentBody>();

    try {
      const comment = commentService.update(c.req.param('id'), {
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.resolved !== undefined ? { resolved: body.resolved } : {}),
      });

      if (!comment) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(comment);
    } catch (error) {
      if (error instanceof InvalidCommentError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.delete('/comments/:id', (c) => {
    const deleted = commentService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
