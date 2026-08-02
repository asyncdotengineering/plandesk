import { Hono } from 'hono';
import { artifactKinds } from '@plandesk/db';
import {
  htmlArtifactCsp,
  resolveRenderOrigin,
  wrapHtmlArtifactForRender,
} from '../html-artifact.js';
import {
  ExternalReferenceError,
  InvalidArtifactError,
  UnknownLibraryError,
  type ArtifactService,
} from '../services/artifacts.js';

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

function screenScanErrorResponse(
  c: { json: (body: unknown, status: 422) => Response },
  error: unknown,
): Response | null {
  if (error instanceof ExternalReferenceError) {
    return c.json({ error: 'external_reference', refs: error.refs }, 422);
  }
  if (error instanceof UnknownLibraryError) {
    return c.json({ error: 'unknown_library', refs: error.refs }, 422);
  }
  return null;
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
      const scan = screenScanErrorResponse(c, error);
      if (scan) {
        return scan;
      }
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

  /**
   * Serve a screen as executable HTML with an origin-parameterised CSP.
   * Org isolation: `artifactService.get` refuses cross-org ids (404) — org A
   * cannot render org B's screen by guessing its id. `?v=` is accepted as a
   * cache-buster only; it does not change the body.
   */
  router.get('/artifacts/:id/render', async (c) => {
    const artifact = await artifactService.get(c.req.param('id'));
    if (!artifact || artifact.kind !== 'html') {
      return c.json({ error: 'not_found' }, 404);
    }

    const origin = resolveRenderOrigin(c.req.url);
    const csp = htmlArtifactCsp(origin);
    const body = wrapHtmlArtifactForRender(artifact.content, csp);

    c.header('Content-Security-Policy', csp);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-cache');
    return c.html(body);
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
      const scan = screenScanErrorResponse(c, error);
      if (scan) {
        return scan;
      }
      if (error instanceof InvalidArtifactError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw error;
    }
  });

  return router;
}
