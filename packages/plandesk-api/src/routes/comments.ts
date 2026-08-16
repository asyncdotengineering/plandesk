import { invalidArgument, invalidRequest } from './errors.js';
import { Hono, type Context } from 'hono';
import {
  InvalidCommentError,
  type CommentService,
  type CommentTarget,
} from '../services/comments.js';

type CreateCommentBody = {
  body?: string;
  passage?: string | null;
  anchor?: string | null;
};

type CreateArtifactCommentBody = CreateCommentBody & {
  artifact_id?: string;
};

type UpdateCommentBody = {
  body?: string;
  resolved?: boolean;
};

function parseIncludeResolved(value: string | undefined): boolean {
  return value === 'true';
}

async function handleCreateComment(
  c: Context,
  commentService: CommentService,
  target: CommentTarget,
) {
  const body = await c.req.json<CreateCommentBody>();
  if (typeof body.body !== 'string') {
    return invalidArgument(c, 'body', 'body must be a string');
  }

  try {
    const comment = await commentService.create(target, {
      body: body.body,
      passage: body.passage,
      anchor: body.anchor,
    });

    if (!comment) {
      return c.json({ error: 'not_found' }, 404);
    }

    return c.json(comment, 201);
  } catch (error) {
    if (error instanceof InvalidCommentError) {
      return invalidRequest(c, error.message);
    }
    throw error;
  }
}

async function handleListComments(
  c: Context,
  commentService: CommentService,
  target: CommentTarget,
) {
  const includeResolved = parseIncludeResolved(c.req.query('include_resolved'));
  const comments = await commentService.listByTarget(target, { includeResolved });
  if (!comments) {
    // Fail-closed: out-of-scope target is a 404 with an empty collection body,
    // leaking neither existence nor rows.
    return c.json([], 404);
  }
  return c.json(comments);
}

export function createCommentsRouter(commentService: CommentService): Hono {
  const router = new Hono();

  router.post('/documents/:id/comments', (c) =>
    handleCreateComment(c, commentService, { type: 'document', id: c.req.param('id') }),
  );

  router.get('/documents/:id/comments', (c) =>
    handleListComments(c, commentService, { type: 'document', id: c.req.param('id') }),
  );

  router.post('/tasks/:id/comments', (c) =>
    handleCreateComment(c, commentService, { type: 'task', id: c.req.param('id') }),
  );

  router.get('/tasks/:id/comments', (c) =>
    handleListComments(c, commentService, { type: 'task', id: c.req.param('id') }),
  );

  router.post('/notes/:id/comments', (c) =>
    handleCreateComment(c, commentService, { type: 'note', id: c.req.param('id') }),
  );

  router.get('/notes/:id/comments', (c) =>
    handleListComments(c, commentService, { type: 'note', id: c.req.param('id') }),
  );

  router.post('/submissions/:id/comments', (c) =>
    handleCreateComment(c, commentService, { type: 'submission', id: c.req.param('id') }),
  );

  router.get('/submissions/:id/comments', (c) =>
    handleListComments(c, commentService, { type: 'submission', id: c.req.param('id') }),
  );

  router.get('/projects/:id/comments', async (c) => {
    const includeResolved = parseIncludeResolved(c.req.query('include_resolved'));
    const comments = await commentService.listByProject(c.req.param('id'), { includeResolved });
    if (!comments) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(comments);
  });

  // Artifact comments are project-scoped. The file identity (content-hash+path,
  // which may contain slashes) travels in the JSON body / query, not a path
  // segment, so it never collides with routing.
  router.post('/projects/:id/artifact-comments', async (c) => {
    const body = await c.req.json<CreateArtifactCommentBody>();
    if (typeof body.body !== 'string' || typeof body.artifact_id !== 'string') {
      return invalidRequest(c, 'body and artifact_id are both required and must be strings');
    }
    try {
      const comment = await commentService.createForArtifact(c.req.param('id'), body.artifact_id, {
        body: body.body,
        passage: body.passage,
        anchor: body.anchor,
      });
      if (!comment) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(comment, 201);
    } catch (error) {
      if (error instanceof InvalidCommentError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.get('/projects/:id/artifact-comments', async (c) => {
    const artifactId = c.req.query('artifact_id');
    if (artifactId === undefined || artifactId === '') {
      return invalidArgument(c, 'artifact_id', 'artifact_id query parameter is required');
    }
    const includeResolved = parseIncludeResolved(c.req.query('include_resolved'));
    const comments = await commentService.listForArtifact(c.req.param('id'), artifactId, {
      includeResolved,
    });
    if (!comments) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(comments);
  });

  router.patch('/comments/:id', async (c) => {
    const body = await c.req.json<UpdateCommentBody>();

    try {
      const comment = await commentService.update(c.req.param('id'), {
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.resolved !== undefined ? { resolved: body.resolved } : {}),
      });

      if (!comment) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(comment);
    } catch (error) {
      if (error instanceof InvalidCommentError) {
        return invalidRequest(c, error.message);
      }
      throw error;
    }
  });

  router.delete('/comments/:id', async (c) => {
    const deleted = await commentService.delete(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
