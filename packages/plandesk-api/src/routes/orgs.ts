import { Hono } from 'hono';
import {
  addOrgMember,
  createToken,
  getOrg,
  getOrgMember,
  importProject,
  InvalidExportVersionError,
  listOrgMembers,
  orgRoles,
  PLANDESK_EXPORT_VERSION,
  tokenScopes,
  type Db,
  type OrgRole,
  type PlandeskExportInput,
  type TokenScope,
} from '@plandesk/db';
import { getAuthContext } from '../auth-context.js';
import { requireRole } from '../permissions.js';

function isOrgRole(value: string): value is OrgRole {
  return (orgRoles as readonly string[]).includes(value);
}

function isTokenScope(value: string): value is TokenScope {
  return (tokenScopes as readonly string[]).includes(value);
}

/**
 * There is deliberately no `POST /orgs`.
 *
 * An org is only ever created by resolving an identity — `findOrCreateOrgForIdentity`
 * on GitHub sign-in (browser or device flow), which keys on `github:<numeric id>` and
 * so yields exactly one org per identity — or by `ensureDefaultOrg` at `serve` boot for
 * the local/self-host single-org case. Both bound creation by construction, which is why
 * no quota is needed to bound it.
 *
 * A general authenticated create route had no caller and could not be guarded the way
 * every route below is: with no `:id` to compare against, `getAuthContext().orgId !== orgId`
 * has nothing to check, so any valid token from any org could mint unlimited orgs, each
 * returning a fresh owner token — and it took `owner_ref` from the body, forging an
 * identity the server is supposed to resolve. Removing the route closes both; a limit
 * would only have capped how far they went.
 */
export function createOrgsRouter(db: Db): Hono {
  const router = new Hono();

  router.post('/orgs/:id/tokens', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }

    // Caller must already be authenticated as this org (token or sole default).
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    requireRole(getAuthContext(), 'owner');

    const body = await c.req.json<{ name?: string; scope?: string }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    let scope: TokenScope = 'full';
    if (body.scope !== undefined) {
      if (!isTokenScope(body.scope)) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      scope = body.scope;
    }

    const created = await createToken(db, {
      name: body.name.trim(),
      orgId,
      scope,
    });

    return c.json(
      {
        id: created.id,
        name: created.name,
        token: created.token,
        scope: created.scope,
      },
      201,
    );
  });

  router.post('/orgs/:id/members', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    requireRole(getAuthContext(), 'owner');

    const body = await c.req.json<{ user_ref?: string; role?: string }>();
    if (typeof body.user_ref !== 'string' || body.user_ref.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.role !== 'string' || !isOrgRole(body.role)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const existing = await getOrgMember(db, orgId, body.user_ref.trim());
    if (existing) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const member = await addOrgMember(db, {
      orgId,
      userRef: body.user_ref.trim(),
      role: body.role,
    });

    return c.json(
      {
        org_id: member.orgId,
        user_ref: member.userRef,
        role: member.role,
        created_at: member.createdAt.toISOString(),
      },
      201,
    );
  });

  router.get('/orgs/:id/members', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    requireRole(getAuthContext(), 'owner');

    const members = await listOrgMembers(db, orgId);
    return c.json(
      members.map((m) => ({
        org_id: m.orgId,
        user_ref: m.userRef,
        role: m.role,
        created_at: m.createdAt.toISOString(),
      })),
    );
  });

  // Promote a portable export into this org (one-way authority handoff).
  router.post('/orgs/:id/import', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    // Org-scoped: token for org-B cannot import into org-A.
    if (getAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    requireRole(getAuthContext(), 'owner');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (body === null || typeof body !== 'object') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const data = body as PlandeskExportInput;
    if (typeof data.version !== 'string' || data.version !== PLANDESK_EXPORT_VERSION) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (data.project === undefined || typeof data.project !== 'object') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      // orgId always from authenticated path/context — never from the body.
      const { projectId } = await importProject(db, data, { orgId });
      return c.json({ globalProjectId: projectId }, 201);
    } catch (err) {
      if (err instanceof InvalidExportVersionError) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      throw err;
    }
  });

  return router;
}
