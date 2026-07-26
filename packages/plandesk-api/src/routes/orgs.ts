import { Hono } from 'hono';
import {
  getProjectInOrg,
  importProject,
  InvalidExportVersionError,
  PLANDESK_EXPORT_VERSION,
  type Db,
  type PlandeskExportInput,
} from '@plandesk/db';
import {
  createScopedAgentKey,
  createWorkspaceScopedAgentKey,
  type CreateScopedAgentKeyInput,
} from '../agent-keys.js';
import { getAuthContext, getOrgAuthContext } from '../auth-context.js';
import type { BetterAuthInstance } from '../better-auth.js';
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  isAuthApiError,
  isInvitationRole,
} from '../invitations.js';
import {
  getInvitationPreview,
  getOrganizationById,
  listOrganizationMembers,
} from '../organizations.js';
import { createTeamForOrg, getTeamInOrg } from '../identity.js';
import { requirePermission, type PermissionSet } from '../permissions.js';

function isPermissionSet(value: unknown): value is PermissionSet {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  for (const actions of Object.values(value as Record<string, unknown>)) {
    if (
      !Array.isArray(actions) ||
      !actions.every((action): action is string => typeof action === 'string')
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve the better-auth user id that will own the minted agent key.
 * Apikey (owner key) carries userId; session needs a better-auth session cookie.
 */
async function resolveMintUserId(
  betterAuth: BetterAuthInstance,
  headers: Headers,
): Promise<string | undefined> {
  const ctx = getAuthContext();
  if (ctx.kind === 'apikey') {
    return ctx.userId;
  }
  if (ctx.kind === 'session') {
    const baSession = await betterAuth.api.getSession({ headers });
    if (baSession === null) {
      return undefined;
    }
    return baSession.user.id;
  }
  return undefined;
}

export type OrgsRouterOptions = {
  betterAuth?: BetterAuthInstance;
  /** Base URL for claim links returned from invitations (no trailing slash required). */
  baseURL?: string;
};

/**
 * There is deliberately no `POST /orgs`.
 *
 * An org is only ever created by better-auth identity provisioning (BA4c) or by
 * `ensureLocalBetterAuthOrganization` at `serve` boot for the local single-org case.
 * Both bound creation by construction, which is why no quota is needed to bound it.
 */
export function createOrgsRouter(db: Db, options: OrgsRouterOptions = {}): Hono {
  const router = new Hono();
  const betterAuth = options.betterAuth;
  const baseURL = options.baseURL ?? 'http://127.0.0.1';

  async function requireKnownOrg(orgId: string): Promise<boolean> {
    if (getOrgAuthContext().orgId !== orgId) {
      return false;
    }
    if (betterAuth === undefined) {
      return true;
    }
    return (await getOrganizationById(betterAuth, orgId)) !== undefined;
  }

  /**
   * REQ-A1: list teams (workspaces) in an org. Any org member may read.
   * A workspace/project-scoped agent key sees only its own workspace (never
   * sibling workspaces); owner keys and sessions keep full org reach.
   */
  router.get('/orgs/:orgId/workspaces', async (c) => {
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }
    const orgId = c.req.param('orgId');
    if (!(await requireKnownOrg(orgId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const adapter = (await betterAuth.$context).adapter;
    let teams = await adapter.findMany<{ id: string; name: string }>({
      model: 'team',
      where: [{ field: 'organizationId', value: orgId }],
    });
    const authCtx = getOrgAuthContext();
    if (authCtx.kind === 'apikey' && authCtx.profile === 'agent') {
      const allowed = new Set<string>();
      if (authCtx.workspaceId !== undefined) {
        allowed.add(authCtx.workspaceId);
      } else if (authCtx.projectId !== undefined) {
        const project = await getProjectInOrg(db, authCtx.projectId, orgId);
        if (project !== undefined) {
          allowed.add(project.workspaceId);
        }
      }
      teams = teams.filter((t) => allowed.has(t.id));
    }
    return c.json({ workspaces: teams.map((t) => ({ id: t.id, name: t.name })) }, 200);
  });

  /**
   * REQ-A2: create a team (workspace) in an org. Owner only — agent apikeys are
   * rejected outright (403) so even a stray custom team:create permission (which
   * AGENT_FORBIDDEN_RESOURCES strips) can never create a workspace.
   */
  router.post('/orgs/:orgId/workspaces', async (c) => {
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }
    const orgId = c.req.param('orgId');
    if (!(await requireKnownOrg(orgId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const authCtx = getOrgAuthContext();
    if (authCtx.kind === 'apikey' && authCtx.profile === 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    requirePermission(authCtx, 'team', 'create');

    const body = await c.req.json<{ name?: unknown }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const name = body.name.trim();

    const team = await createTeamForOrg(betterAuth, orgId, name);
    return c.json({ id: team.id, name: team.name }, 201);
  });

  /**
   * BA4b-3 + REQ-A3: mint a project-scoped or workspace-scoped agent key.
   * Caller must hold apiKey:create (owner key or session owner) — agent keys cannot.
   */
  router.post('/orgs/:orgId/agent-keys', async (c) => {
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }

    const orgId = c.req.param('orgId');
    if (!(await requireKnownOrg(orgId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    requirePermission(getOrgAuthContext(), 'apiKey', 'create');

    const body = await c.req.json<{
      project_id?: string;
      team_id?: string;
      permissions?: unknown;
      name?: unknown;
    }>();

    let permissions: PermissionSet | undefined;
    if (body.permissions !== undefined) {
      if (!isPermissionSet(body.permissions)) {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      permissions = body.permissions;
    }

    let name: string | undefined;
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return c.json({ error: 'invalid_argument' }, 400);
      }
      name = body.name.trim();
    }

    const userId = await resolveMintUserId(betterAuth, c.req.raw.headers);
    if (userId === undefined) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const hasProjectId = typeof body.project_id === 'string' && body.project_id.trim() !== '';
    const hasTeamId = typeof body.team_id === 'string' && body.team_id.trim() !== '';

    if (hasProjectId && hasTeamId) {
      return c.json({ error: 'invalid_argument' }, 400);
    }

    if (hasProjectId) {
      if (typeof body.project_id !== 'string') {
        throw new Error('Missing project_id after validation');
      }
      const projectId = body.project_id.trim();
      const project = await getProjectInOrg(db, projectId, orgId);
      if (project === undefined) {
        return c.json({ error: 'not_found' }, 404);
      }

      const mintInput: CreateScopedAgentKeyInput = {
        auth: betterAuth,
        userId,
        orgId,
        projectId,
        ...(permissions !== undefined ? { permissions } : {}),
        ...(name !== undefined ? { name } : {}),
      };
      const minted = await createScopedAgentKey(mintInput);
      return c.json({ token: minted.key, project_id: projectId }, 200);
    }

    if (hasTeamId) {
      if (typeof body.team_id !== 'string') {
        throw new Error('Missing team_id after validation');
      }
      const teamId = body.team_id.trim();
      const adapter = (await betterAuth.$context).adapter;
      const team = await adapter.findOne<{ id: string; organizationId: string }>({
        model: 'team',
        where: [
          { field: 'id', value: teamId },
          { field: 'organizationId', value: orgId },
        ],
      });
      if (team === null) {
        return c.json({ error: 'not_found' }, 404);
      }

      const minted = await createWorkspaceScopedAgentKey({
        auth: betterAuth,
        userId,
        orgId,
        teamId,
        ...(permissions !== undefined ? { permissions } : {}),
        ...(name !== undefined ? { name } : {}),
      });
      return c.json({ token: minted.key, team_id: teamId }, 200);
    }

    return c.json({ error: 'invalid_argument' }, 400);
  });

  /**
   * List better-auth org members (role + email). Any org member may read; agent
   * apikeys never receive member PII (403). Owner keys and sessions unchanged.
   */
  router.get('/orgs/:id/members', async (c) => {
    const orgId = c.req.param('id');
    if (!(await requireKnownOrg(orgId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const authCtx = getOrgAuthContext();
    if (authCtx.kind === 'apikey' && authCtx.profile === 'agent') {
      return c.json({ error: 'forbidden' }, 403);
    }
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }
    const members = await listOrganizationMembers(betterAuth, orgId);
    return c.json({ members }, 200);
  });

  /**
   * BA3c / RFC§5: invite by email to a workspace (link-only, no mailer). The
   * team_id is required — invites are workspace-scoped; accepting joins the
   * team, not just the org. Owners and admins may invite (invitation:create);
   * better-auth still blocks a non-owner inviting an owner. Returns claimUrl
   * for the inviter to deliver by hand.
   */
  router.post('/orgs/:id/invitations', async (c) => {
    const orgId = c.req.param('id');
    if (!(await requireKnownOrg(orgId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const authCtx = getOrgAuthContext();
    // Session only — token/loopback cannot drive better-auth createInvitation.
    if (authCtx.kind !== 'session') {
      return c.json({ error: 'forbidden' }, 403);
    }
    requirePermission(authCtx, 'invitation', 'create');

    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }

    const body = await c.req.json<{ email?: string; role?: string; team_id?: string }>();
    if (typeof body.email !== 'string' || body.email.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.role !== 'string' || !isInvitationRole(body.role)) {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (typeof body.team_id !== 'string' || body.team_id.trim() === '') {
      return c.json({ error: 'invalid_argument', message: 'team_id is required' }, 400);
    }
    const teamId = body.team_id.trim();
    const team = await getTeamInOrg(betterAuth, teamId, orgId);
    if (team === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    try {
      const created = await createOrganizationInvitation(betterAuth, {
        email: body.email,
        role: body.role,
        organizationId: orgId,
        teamId,
        headers: c.req.raw.headers,
        baseURL,
      });
      return c.json(
        {
          invitationId: created.invitationId,
          claimUrl: created.claimUrl,
          teamId: created.teamId,
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
   * Preview an invitation (capability: the unguessable id is the authorization).
   * Public so the claim page can render "you've been invited to X as Y" before
   * the invitee signs in. Returns org name + role + invited email + status.
   */
  router.get('/invitations/:invitationId', async (c) => {
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }
    const invitationId = c.req.param('invitationId');
    if (invitationId.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const preview = await getInvitationPreview(betterAuth, invitationId);
    if (preview === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(preview, 200);
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
          teamId: result.invitation.teamId,
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
    // Org-scoped: token for org-B cannot import into org-A.
    if (!(await requireKnownOrg(orgId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    requirePermission(getOrgAuthContext(), 'organization', 'update');
    // Import lands the project in the org-default workspace (the portable
    // format carries no workspace), so a workspace/project-scoped agent key
    // would escape its scope. Reject scoped callers before reading the body.
    const importAuthCtx = getOrgAuthContext();
    if (
      (importAuthCtx.kind === 'apikey' &&
        (importAuthCtx.workspaceId !== undefined || importAuthCtx.projectId !== undefined)) ||
      (importAuthCtx.kind === 'loopback' && importAuthCtx.workspaceId !== undefined)
    ) {
      return c.json({ error: 'forbidden' }, 403);
    }

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
