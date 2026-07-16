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
import { getOrgAuthContext } from '../auth-context.js';
import type { BetterAuthInstance } from '../better-auth.js';
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  isAuthApiError,
  isInvitationRole,
} from '../invitations.js';
import { requirePermission } from '../permissions.js';

function isOrgRole(value: string): value is OrgRole {
  return (orgRoles as readonly string[]).includes(value);
}

function isTokenScope(value: string): value is TokenScope {
  return (tokenScopes as readonly string[]).includes(value);
}

export type OrgsRouterOptions = {
  betterAuth?: BetterAuthInstance;
  /** Base URL for claim links returned from invitations (no trailing slash required). */
  baseURL?: string;
};

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
export function createOrgsRouter(db: Db, options: OrgsRouterOptions = {}): Hono {
  const router = new Hono();
  const betterAuth = options.betterAuth;
  const baseURL = options.baseURL ?? 'http://127.0.0.1';

  router.post('/orgs/:id/tokens', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }

    // Caller must already be authenticated as this org (token or sole default).
    if (getOrgAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    // Permission-set check (BA2/BA5): agent keys never hold apiKey:create.
    requirePermission(getOrgAuthContext(), 'apiKey', 'create');

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
    if (getOrgAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    requirePermission(getOrgAuthContext(), 'member', 'create');

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
    if (getOrgAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    // Listing members is owner-only; owner alone holds member:create.
    requirePermission(getOrgAuthContext(), 'member', 'create');

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

  /**
   * BA3c: invite by email (link-only, no mailer). Session owner only
   * (member:create). Returns claimUrl for the inviter to deliver by hand.
   */
  router.post('/orgs/:id/invitations', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    const authCtx = getOrgAuthContext();
    if (authCtx.orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    // Session owner only — token/loopback cannot drive better-auth createInvitation.
    if (authCtx.kind !== 'session') {
      return c.json({ error: 'forbidden' }, 403);
    }
    requirePermission(authCtx, 'member', 'create');

    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }

    const body = await c.req.json<{ email?: string; role?: string }>();
    if (typeof body.email !== 'string' || body.email.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.role !== 'string' || !isInvitationRole(body.role)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    try {
      const created = await createOrganizationInvitation(betterAuth, {
        email: body.email,
        role: body.role,
        organizationId: orgId,
        headers: c.req.raw.headers,
        baseURL,
      });
      return c.json(
        {
          invitationId: created.invitationId,
          claimUrl: created.claimUrl,
        },
        201,
      );
    } catch (err) {
      if (isAuthApiError(err)) {
        if (err.statusCode === 403 || err.status === 'FORBIDDEN') {
          return c.json({ error: 'forbidden' }, 403);
        }
        return c.json({ error: 'invalid_argument', message: err.message }, 400);
      }
      throw err;
    }
  });

  /**
   * BA3c: accept invitation. Session-gated at the handler (public path so
   * org-less invitees can reach it); not org-gated. Single-use → 410 on retry.
   */
  router.post('/invitations/:invitationId/accept', async (c) => {
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }
    const invitationId = c.req.param('invitationId');
    if (invitationId.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
    if (session === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    try {
      const result = await acceptOrganizationInvitation(betterAuth, {
        invitationId,
        headers: c.req.raw.headers,
      });
      return c.json(
        {
          invitationId: result.invitation.id,
          organizationId: result.member.organizationId,
          role: result.member.role,
          userId: result.member.userId,
        },
        200,
      );
    } catch (err) {
      if (isAuthApiError(err)) {
        // Already accepted / expired / missing → single-use CAS failure.
        if (
          err.statusCode === 400 ||
          err.status === 'BAD_REQUEST' ||
          err.message.toLowerCase().includes('invitation')
        ) {
          return c.json({ error: 'gone', message: err.message }, 410);
        }
        if (err.statusCode === 403 || err.status === 'FORBIDDEN') {
          return c.json({ error: 'forbidden' }, 403);
        }
        return c.json({ error: 'invalid_argument', message: err.message }, 400);
      }
      throw err;
    }
  });

  // Promote a portable export into this org (one-way authority handoff).
  router.post('/orgs/:id/import', async (c) => {
    const orgId = c.req.param('id');
    const org = await getOrg(db, orgId);
    if (!org) {
      return c.json({ error: 'not_found' }, 404);
    }
    // Org-scoped: token for org-B cannot import into org-A.
    if (getOrgAuthContext().orgId !== orgId) {
      return c.json({ error: 'not_found' }, 404);
    }
    requirePermission(getOrgAuthContext(), 'organization', 'update');

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
