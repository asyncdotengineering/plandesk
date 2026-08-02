import { Hono } from 'hono';
import { artifactKinds } from '@plandesk/db';
import { InvalidArtifactError, type ArtifactService } from '../services/artifacts.js';

type CreateArtifactBody = {
  title?: string;
  kind?: (typeof artifactKinds)[number];
  content?: string;
  prototype_id?: string | null;
};

type UpdateArtifactBody = {
  title?: string;
  kind?: (typeof artifactKinds)[number];
  content?: string;
  prototype_id?: string | null;
};

function isValidKind(kind: string): kind is (typeof artifactKinds)[number] {
  return (artifactKinds as readonly string[]).includes(kind);
}

export function createArtifactsRouter(artifactService: ArtifactService): Hono {
  const router = new Hono();

  router.get('/projects/:id/artifacts', async (c) => {
    const artifacts = await artifactService.listByProject(c.req.param('id'));
    if (!artifacts) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(artifacts);
  });

  router.post('/projects/:id/artifacts', async (c) => {
    const body = await c.req.json<CreateArtifactBody>();
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.kind !== undefined && !isValidKind(body.kind)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const artifact = await artifactService.create(c.req.param('id'), {
        title: body.title,
        kind: body.kind,
        content: body.content,
        ...(body.prototype_id !== undefined ? { prototypeId: body.prototype_id } : {}),
      });

      if (!artifact) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(artifact, 201);
    } catch (error) {
      if (error instanceof InvalidArtifactError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  router.get('/artifacts/:id', async (c) => {
    const artifact = await artifactService.get(c.req.param('id'));
    if (!artifact) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(artifact);
  });

  router.patch('/artifacts/:id', async (c) => {
    const body = await c.req.json<UpdateArtifactBody>();
    if (body.kind !== undefined && !isValidKind(body.kind)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const artifact = await artifactService.update(c.req.param('id'), {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.prototype_id !== undefined ? { prototypeId: body.prototype_id } : {}),
      });

      if (!artifact) {
        return c.json({ error: 'not_found' }, 404);
      }

      return c.json(artifact);
    } catch (error) {
      if (error instanceof InvalidArtifactError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  return router;
}