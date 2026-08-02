import { Hono } from 'hono';
import {
  artifactKinds,
  createRenderToken,
  getPrototypeByProjectAndId,
  type Db,
} from '@plandesk/db';
import { tryGetAuthContext } from '../auth-context.js';
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
import {
  artifactAuthorizedByCredential,
  rewriteFrameResourceRefs,
  verifyFrameCredential,
  type FrameCredential,
} from '../services/frame-credential.js';
import { assertPermission, resolveOrgId } from '../services/org-scope.js';
import { assertProjectInOrg, ProjectNotInOrgError } from '../services/scope.js';

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
  x?: number | null;
  y?: number | null;
};

type MoveCopyBody = {
  prototype_id?: string;
};

type MintRenderTokenBody = {
  prototype_ids?: unknown;
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

export type ArtifactsRouterDeps = {
  db: Db;
};

async function mintCredentialForAuthenticatedRender(
  db: Db,
  projectId: string,
  prototypeId: string | null,
): Promise<FrameCredential | undefined> {
  const auth = tryGetAuthContext();
  if (auth === undefined || auth.kind === 'guest') {
    return undefined;
  }
  const prototypeIds = prototypeId === null ? [] : [prototypeId];
  const minted = await createRenderToken(db, {
    orgId: auth.orgId,
    projectId,
    prototypeIds,
  });
  return {
    kind: 'render',
    orgId: auth.orgId,
    projectId,
    prototypeIds,
    rawToken: minted.token,
  };
}

export function createArtifactsRouter(
  artifactService: ArtifactService,
  deps: ArtifactsRouterDeps,
): Hono {
  const { db } = deps;
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

  /**
   * Mint a short-lived render token for Moment B (opaque-origin subresources)
   * and portal-guest Moment A. Scoped to prototype ids in this project.
   * Org isolation: assertProjectInOrg refuses org B's project id for org A.
   */
  router.post('/projects/:id/render-tokens', async (c) => {
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as MintRenderTokenBody;
    if (!Array.isArray(body.prototype_ids)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const prototypeIds = body.prototype_ids.filter((id): id is string => typeof id === 'string');
    if (prototypeIds.length !== body.prototype_ids.length) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      assertPermission({}, 'document', 'read');
      await assertProjectInOrg(db, projectId, resolveOrgId({}));
    } catch (error) {
      if (error instanceof ProjectNotInOrgError) {
        return c.json({ error: 'not_found' }, 404);
      }
      throw error;
    }

    for (const prototypeId of prototypeIds) {
      const proto = await getPrototypeByProjectAndId(db, projectId, prototypeId);
      if (!proto) {
        return c.json({ error: 'not_found' }, 404);
      }
    }

    const auth = tryGetAuthContext();
    if (auth === undefined || auth.kind === 'guest') {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const minted = await createRenderToken(db, {
      orgId: auth.orgId,
      projectId,
      prototypeIds,
    });

    return c.json(
      {
        token: minted.token,
        expires_at: minted.row.expiresAt.toISOString(),
        prototype_ids: prototypeIds,
      },
      201,
    );
  });

  router.get('/artifacts/:id', async (c) => {
    const artifact = await artifactService.get(c.req.param('id'));
    if (!artifact) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(artifact);
  });

  router.post('/artifacts/:id/move', async (c) => {
    const body = await c.req.json<MoveCopyBody>();
    if (typeof body.prototype_id !== 'string' || body.prototype_id.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    try {
      const artifact = await artifactService.move(c.req.param('id'), body.prototype_id);
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

  router.post('/artifacts/:id/copy', async (c) => {
    const body = await c.req.json<MoveCopyBody>();
    if (typeof body.prototype_id !== 'string' || body.prototype_id.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    try {
      const artifact = await artifactService.copy(c.req.param('id'), body.prototype_id);
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

  /**
   * Serve a screen as executable HTML with an origin-parameterised CSP.
   * Credential: session/loopback (Moment A for authenticated viewers) **or**
   * `?token=` share/render token (Moment B + portal guest). One verification
   * point via verifyFrameCredential. Org isolation: session path uses
   * artifactService.get (cross-org → 404); token path checks projectId +
   * prototype coverage, so org A's token cannot render org B's screen.
   */
  router.get('/artifacts/:id/render', async (c) => {
    const artifactId = c.req.param('id');
    const rawToken = c.req.query('token');
    const origin = resolveRenderOrigin(c.req.url);

    let content: string;
    let credential: FrameCredential | undefined;

    if (typeof rawToken === 'string' && rawToken.trim() !== '') {
      credential = await verifyFrameCredential(db, rawToken);
      if (!credential) {
        return c.json({ error: 'not_found' }, 404);
      }
      const authorized = await artifactAuthorizedByCredential(db, credential, artifactId);
      if (!authorized || authorized.kind !== 'html') {
        return c.json({ error: 'not_found' }, 404);
      }
      content = authorized.content;
    } else {
      const artifact = await artifactService.get(artifactId);
      if (!artifact || artifact.kind !== 'html') {
        return c.json({ error: 'not_found' }, 404);
      }
      content = artifact.content;
      // Auto-mint for Moment B rewrites when the frame document itself used a
      // session cookie (Moment A needs no token for authenticated viewers).
      credential = await mintCredentialForAuthenticatedRender(
        db,
        artifact.project_id,
        artifact.prototype_id,
      );
    }

    if (credential !== undefined) {
      content = await rewriteFrameResourceRefs(db, content, origin, credential);
    }

    const csp = htmlArtifactCsp(origin);
    const body = wrapHtmlArtifactForRender(content, csp);

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
    if (body.x !== undefined && body.x !== null && !Number.isFinite(body.x)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body.y !== undefined && body.y !== null && !Number.isFinite(body.y)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const artifact = await artifactService.update(c.req.param('id'), {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.prototype_id !== undefined ? { prototypeId: body.prototype_id } : {}),
        ...(body.x !== undefined ? { x: body.x } : {}),
        ...(body.y !== undefined ? { y: body.y } : {}),
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
