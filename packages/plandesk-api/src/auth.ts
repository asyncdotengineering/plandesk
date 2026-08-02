import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import {
  DEFAULT_ORG_ID,
  hashShareToken,
  orgRoles,
  verifyGuestSession,
  getAgentRun,
  type Db,
  type OrgRole,
} from '@plandesk/db';
import {
  applyAgentKeyPermissionCeiling,
  verifyBetterAuthApiKey,
} from './agent-keys.js';
import { runWithAuthContext, tryGetAuthContext, type AuthContext } from './auth-context.js';
import type { BetterAuthInstance } from './better-auth.js';
import { userRefFromGithubAccountId, listMemberWorkspaceIds } from './identity.js';
import { resolveDefaultOrganization } from './organizations.js';
import {
  hasAnyWritePermission,
  orgRoleToPermissionSet,
} from './permissions.js';
import { readGuestSessionCookie } from './session.js';
import { assertProjectInOrg, ProjectNotInOrgError } from './services/scope.js';

const BASIC_PREFIX = 'Basic ';
const BASIC_USER = 'plandesk';
const BEARER_PREFIX = 'Bearer ';
const GITHUB_PROVIDER_ID = 'github';
const AGENT_RUN_HEADER = 'x-plandesk-agent-run-id';

function parseOrgRole(role: string): OrgRole | undefined {
  for (const candidate of orgRoles) {
    if (candidate === role) {
      return candidate;
    }
  }
  return undefined;
}

type BetterAuthAccountRow = {
  accountId: string;
  providerId: string;
  userId: string;
};

type BetterAuthSessionRow = {
  token: string;
  activeOrganizationId?: string | null;
};

type BetterAuthMemberRow = {
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

function decodeBasicAuth(header: string): Buffer | undefined {
  if (!header.startsWith(BASIC_PREFIX)) {
    return undefined;
  }
  try {
    return Buffer.from(header.slice(BASIC_PREFIX.length), 'base64');
  } catch {
    return undefined;
  }
}

function credentialsMatch(provided: Buffer, expected: Buffer): boolean {
  if (provided.length !== expected.length) {
    return false;
  }
  // @types/node Buffer generics are not assignable to ArrayBufferView directly.
  return timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected));
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.toLowerCase().startsWith(BEARER_PREFIX.toLowerCase())) {
    return undefined;
  }
  const raw = header.slice(BEARER_PREFIX.length).trim();
  return raw.length > 0 ? raw : undefined;
}

/** True when the server is bound only to loopback (trusted local network boundary). */
export function isLoopbackBind(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

export type OrgAuthOptions = {
  db: Db;
  /** Server bind address. Loopback default-org only when this is loopback. */
  bindHost: string;
  /**
   * better-auth instance when configured. Session cookies issued by better-auth
   * are recognized here; omit and only apiKey / loopback / guest apply.
   */
  betterAuth?: BetterAuthInstance;
};

/**
 * Resolve a better-auth session into AuthContext.
 * - null session → undefined (caller falls through to loopback)
 * - session but no org membership → 'unauthorized' (authenticated-but-org-less)
 * - session + membership → AuthContext kind session
 */
async function resolveBetterAuthSessionContext(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<AuthContext | 'unauthorized' | undefined> {
  const session = await auth.api.getSession({ headers });
  if (session === null) {
    return undefined;
  }

  const adapter = (await auth.$context).adapter;
  const userId = session.user.id;

  const members = await adapter.findMany<BetterAuthMemberRow>({
    model: 'member',
    where: [{ field: 'userId', value: userId }],
    sortBy: { field: 'createdAt', direction: 'asc' },
  });
  // Membership revoked or never granted: cookie carries no org authority.
  if (members.length === 0) {
    return 'unauthorized';
  }

  const sessionRow = await adapter.findOne<BetterAuthSessionRow>({
    model: 'session',
    where: [{ field: 'token', value: session.session.token }],
  });
  const activeOrganizationId = sessionRow?.activeOrganizationId;
  const active =
    (activeOrganizationId === undefined || activeOrganizationId === null
      ? undefined
      : members.find((member) => member.organizationId === activeOrganizationId)) ?? members[0];
  if (active === undefined) {
    return 'unauthorized';
  }
  if (active.organizationId !== activeOrganizationId) {
    await (await auth.$context).internalAdapter.updateSession(session.session.token, {
      activeOrganizationId: active.organizationId,
    });
  }
  const role = parseOrgRole(active.role);
  if (role === undefined) {
    return 'unauthorized';
  }

  // GitHub-linked users keep github:<id> as the stable ref (BA4a).
  // Password-only members (invite bootstrap, no GitHub app — REQ-20 / BA3c)
  // use user:<better-auth user id> so they can hold a session AuthContext.
  const account = await adapter.findOne<BetterAuthAccountRow>({
    model: 'account',
    where: [
      { field: 'userId', value: userId },
      { field: 'providerId', value: GITHUB_PROVIDER_ID },
    ],
  });
  let userRef: string;
  if (account !== null) {
    try {
      userRef = userRefFromGithubAccountId(account.accountId);
    } catch {
      return 'unauthorized';
    }
  } else {
    userRef = `user:${userId}`;
  }

  return {
    kind: 'session',
    orgId: active.organizationId,
    userRef,
    userId,
    role,
    permission: orgRoleToPermissionSet(role),
    memberWorkspaceIds: await listMemberWorkspaceIds(auth, userId, active.organizationId),
  };
}

type ApiKeyMetadata = {
  projectId?: unknown;
  orgId?: unknown;
  kind?: unknown;
  teamId?: unknown;
};

/**
 * Read better-auth key metadata. Absent/unknown `kind` → `'agent'` (BA4b-1
 * back-compat: every key minted without kind keeps agent ceiling).
 */
export function readApiKeyMetadata(metadata: unknown): {
  orgId: string | undefined;
  projectId: string | undefined;
  workspaceId: string | undefined;
  kind: 'agent' | 'owner';
} {
  if (metadata === null || metadata === undefined || typeof metadata !== 'object') {
    return { orgId: undefined, projectId: undefined, workspaceId: undefined, kind: 'agent' };
  }
  const m = metadata as ApiKeyMetadata;
  return {
    orgId: typeof m.orgId === 'string' && m.orgId.length > 0 ? m.orgId : undefined,
    projectId:
      typeof m.projectId === 'string' && m.projectId.length > 0 ? m.projectId : undefined,
    workspaceId: typeof m.teamId === 'string' && m.teamId.length > 0 ? m.teamId : undefined,
    kind: m.kind === 'owner' ? 'owner' : 'agent',
  };
}

/**
 * Resolve live better-auth member role for (userId, orgId).
 * No member row → undefined (ceiling becomes empty permissions).
 */
async function resolveBetterAuthLiveRole(
  auth: BetterAuthInstance,
  userId: string,
  orgId: string,
): Promise<OrgRole | undefined> {
  const adapter = (await auth.$context).adapter;
  const members = await adapter.findMany<BetterAuthMemberRow>({
    model: 'member',
    where: [
      { field: 'userId', value: userId },
      { field: 'organizationId', value: orgId },
    ],
  });
  const active = members[0];
  if (active === undefined) {
    return undefined;
  }
  return parseOrgRole(active.role);
}

/**
 * Try better-auth API key first (BA5). Returns:
 * - AuthContext when the bearer is a valid better-auth key with org metadata
 * - 'unauthorized' when the key is valid but unusable (no org)
 * - undefined when not a better-auth key (caller rejects as 401)
 */
async function resolveBetterAuthApiKeyContext(
  auth: BetterAuthInstance,
  bearer: string,
): Promise<AuthContext | 'unauthorized' | undefined> {
  const verified = await verifyBetterAuthApiKey(auth, bearer);
  if (verified === undefined) {
    return undefined;
  }

  const userId = verified.referenceId;
  const { orgId, projectId, workspaceId, kind } = readApiKeyMetadata(verified.metadata);
  if (orgId === undefined) {
    return 'unauthorized';
  }

  const liveRole = await resolveBetterAuthLiveRole(auth, userId, orgId);
  const permission = applyAgentKeyPermissionCeiling(
    verified.permissions,
    liveRole,
    kind,
  );

  return {
    kind: 'apikey',
    orgId,
    userId,
    profile: kind,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    role: liveRole,
    permission,
  };
}

async function attachAgentRunIdFromHeader(
  db: Db,
  ctx: AuthContext,
  headers: Headers,
): Promise<AuthContext> {
  if (ctx.kind !== 'apikey') {
    return ctx;
  }
  const raw = headers.get(AGENT_RUN_HEADER);
  if (raw === null || raw.trim() === '') {
    return ctx;
  }
  const runId = raw.trim();
  const run = await getAgentRun(db, runId);
  if (run?.status !== 'running') {
    return ctx;
  }
  try {
    // Reuse scope.ts: org boundary via getProjectInOrg; project-bound keys also
    // reject runs from another project in the same org (BA5).
    await runWithAuthContext(ctx, () => assertProjectInOrg(db, run.projectId, ctx.orgId));
  } catch (error) {
    if (error instanceof ProjectNotInOrgError) {
      return ctx;
    }
    throw error;
  }
  return { ...ctx, agentRunId: runId };
}

/**
 * Endpoints that must answer before the caller holds a credential: the method
 * probe the sign-in UI reads, and better-auth's own sign-in surface at /api/auth/*
 * (chicken-and-egg: cannot require a token to obtain one).
 */
const PUBLIC_AUTH_PATHS = new Set([
  '/api/v1/auth/methods',
  '/api/v1/health',
  '/api/auth/*',
]);

/** Invitation accept: invitee may have a session but zero org memberships yet. */
const INVITATION_ACCEPT_PATH = /^\/api\/v1\/invitations\/[^/]+\/accept$/;

/** Invitation preview (GET only): the claim page renders "invited to X" pre-auth. */
const INVITATION_PREVIEW_PATH = /^\/api\/v1\/invitations\/[^/]+$/;

export function isInvitationAcceptPath(path: string): boolean {
  return INVITATION_ACCEPT_PATH.test(path);
}

export function isPublicAuthPath(path: string): boolean {
  if (PUBLIC_AUTH_PATHS.has(path)) {
    return true;
  }
  // better-auth mounts under /api/auth/*; the set holds the prefix pattern.
  if (path === '/api/auth' || path.startsWith('/api/auth/')) {
    return true;
  }
  // BA3c: accept is session-checked in-handler, not org-gated.
  // Preview (GET /invitations/:id) is capability-gated by the unguessable id.
  return isInvitationAcceptPath(path) || INVITATION_PREVIEW_PATH.test(path);
}

/**
 * Pre-join share surfaces: meta (render "X invited you"), join (claim a guest
 * session), and agent markdown links. The portal *view* is NOT public — it
 * requires a guest session issued by join. Share *creation* lives under
 * /tasks/:id/share and /documents/:id/share (org-gated).
 */
const PUBLIC_SHARE_PATH =
  /^\/api\/v1\/share\/[^/]+(\.md|\/meta|\/join)$/;

/** Render + file routes that may carry a frame credential as ?token=. */
const FRAME_CREDENTIAL_PATH =
  /^\/api\/v1\/(artifacts\/[^/]+\/render|files\/[^/]+)$/;

export function isPublicShareReadPath(path: string): boolean {
  return PUBLIC_SHARE_PATH.test(path);
}

export function isFrameCredentialPath(path: string): boolean {
  return FRAME_CREDENTIAL_PATH.test(path);
}

/**
 * Guest-gated portal surfaces: view + submissions (list/submit).
 * Never fall through to loopback/org auth — that would re-open the pre-join bypass.
 */
const SHARE_GUEST_PATH = /^\/api\/v1\/share\/([^/]+)\/(view|submissions)$/;

export function isShareGuestViewPath(path: string): boolean {
  return SHARE_GUEST_PATH.test(path);
}

export function extractShareTokenFromViewPath(path: string): string | undefined {
  const match = SHARE_GUEST_PATH.exec(path);
  return match?.[1];
}

function extractGuestCredential(
  authorizationHeader: string | undefined,
  cookieToken: string | undefined,
): string | undefined {
  return extractBearerToken(authorizationHeader) ?? cookieToken;
}

/**
 * Always-on org resolver for every request:
 * 1. Bearer → better-auth API key (BA5 live-role ceiling) when configured
 * 2. else better-auth session cookie → active org + member role (when configured)
 * 3. else loopback bind + single-org → default org as owner (local, zero friction)
 * 4. else 401
 *
 * A stranger bearer that is not a better-auth key is always 401 (no mcp_token fallback).
 * Every branch yields the same `{ orgId, permission }`, so services downstream
 * are identical for a browser, the CLI, and an agent.
 */
export function createOrgAuthMiddleware(options: OrgAuthOptions): MiddlewareHandler {
  const { db, bindHost, betterAuth } = options;

  return async (c, next) => {
    if (isPublicAuthPath(c.req.path) || isPublicShareReadPath(c.req.path)) {
      await next();
      return;
    }

    // Frame credential on the query string: pass through without org auth.
    // The route verifies share-or-render token itself (one verification point).
    const frameToken = c.req.query('token');
    if (
      isFrameCredentialPath(c.req.path) &&
      typeof frameToken === 'string' &&
      frameToken.trim() !== ''
    ) {
      await next();
      return;
    }

    // Portal view: guest session only — never loopback/org. No credential → 401
    // closes the pre-join bypass; wrong-share session → 404 (no existence leak).
    if (isShareGuestViewPath(c.req.path)) {
      const shareToken = extractShareTokenFromViewPath(c.req.path);
      if (shareToken === undefined) {
        return c.json({ error: 'not_found' }, 404);
      }
      const guestRaw = extractGuestCredential(
        c.req.header('Authorization'),
        readGuestSessionCookie(c),
      );
      if (guestRaw === undefined) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const guest = await verifyGuestSession(db, guestRaw);
      if (guest === undefined) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      if (guest.share.tokenHash !== hashShareToken(shareToken)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const ctx: AuthContext = {
        kind: 'guest',
        shareId: guest.shareId,
        ...(guest.projectId !== null ? { projectId: guest.projectId } : {}),
        ...(guest.workspaceId !== null ? { workspaceId: guest.workspaceId } : {}),
        guestSessionId: guest.id,
      };
      await runWithAuthContext(ctx, async () => {
        await next();
      });
      return;
    }

    const bearer = extractBearerToken(c.req.header('Authorization'));
    if (bearer !== undefined) {
      if (betterAuth !== undefined) {
        const apiKeyCtx = await resolveBetterAuthApiKeyContext(betterAuth, bearer);
        if (apiKeyCtx === 'unauthorized') {
          return c.json({ error: 'unauthorized' }, 401);
        }
        if (apiKeyCtx !== undefined) {
          const withRun = await attachAgentRunIdFromHeader(db, apiKeyCtx, c.req.raw.headers);
          await runWithAuthContext(withRun, async () => {
            await next();
          });
          return;
        }
      }

      // Not a better-auth key (or better-auth not configured): no mcp_token fallback.
      return c.json({ error: 'unauthorized' }, 401);
    }

    if (betterAuth !== undefined) {
      const betterAuthCtx = await resolveBetterAuthSessionContext(betterAuth, c.req.raw.headers);
      if (betterAuthCtx === 'unauthorized' && !isLoopbackBind(bindHost)) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      if (betterAuthCtx !== undefined && betterAuthCtx !== 'unauthorized') {
        await runWithAuthContext(betterAuthCtx, async () => {
          await next();
        });
        return;
      }
    }

    if (isLoopbackBind(bindHost)) {
      // REQ-21: local loopback is always owner — no login, no member row required.
      // Prefer the ensured better-auth default org when present; else DEFAULT_ORG_ID.
      // Soft-fail if BA tables are not migrated yet (createApp boots before migrator).
      let orgId = DEFAULT_ORG_ID;
      if (betterAuth !== undefined) {
        try {
          const org = await resolveDefaultOrganization(betterAuth);
          if (org !== undefined) {
            orgId = org.id;
          }
        } catch {
          // organization table missing / adapter error — keep DEFAULT_ORG_ID
        }
      }
      const headerWorkspaceId = c.req.header('x-plandesk-workspace-id');
      const ctx: AuthContext = {
        kind: 'loopback',
        orgId,
        role: 'owner',
        permission: orgRoleToPermissionSet('owner'),
        ...(headerWorkspaceId !== undefined && headerWorkspaceId.trim() !== ''
          ? { workspaceId: headerWorkspaceId.trim() }
          : {}),
      };
      await runWithAuthContext(ctx, async () => {
        await next();
      });
      return;
    }

    // No credential resolved. API/auth/mcp namespaces require a credential →
    // 401 challenge. Any other path is not an API route, so defer to routing
    // (SPA handler or Hono 404): an unauthenticated probe of an unknown path
    // gets a 404, not a 401 that implies a real route exists there.
    if (
      c.req.path.startsWith('/api/v1') ||
      c.req.path.startsWith('/api/auth') ||
      c.req.path.startsWith('/mcp')
    ) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}

/** Optional Basic auth gate (PLANDESK_AUTH_PASSWORD). Skips MCP paths. */
export function createAuthMiddleware(password: string): MiddlewareHandler {
  const expected = Buffer.from(`${BASIC_USER}:${password}`, 'utf8');

  return async (c, next) => {
    if (c.req.path.startsWith('/mcp')) {
      await next();
      return;
    }

    // Method probe and better-auth sign-in must stay reachable without Basic.
    if (isPublicAuthPath(c.req.path) || isPublicShareReadPath(c.req.path)) {
      await next();
      return;
    }

    const frameToken = c.req.query('token');
    if (
      isFrameCredentialPath(c.req.path) &&
      typeof frameToken === 'string' &&
      frameToken.trim() !== ''
    ) {
      await next();
      return;
    }

    // Bearer tokens are handled by org auth; do not require Basic on top of them.
    if (extractBearerToken(c.req.header('Authorization')) !== undefined) {
      await next();
      return;
    }

    const decoded = decodeBasicAuth(c.req.header('Authorization') ?? '');
    if (decoded === undefined || !credentialsMatch(decoded, expected)) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Basic realm="Plan Desk"',
      });
    }

    await next();
  };
}

/**
 * Reject pure read-only callers (empty permission set) on write HTTP methods.
 * Resource:action checks are enforced in services via requirePermission.
 */
/** Guest may POST only moderated submissions for their share (BA6b). */
const SHARE_GUEST_SUBMIT_PATH = /^\/api\/v1\/share\/[^/]+\/submissions$/;

export function createWriteGuardMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const ctx = tryGetAuthContext();
      if (ctx !== undefined) {
        if (ctx.kind === 'guest') {
          // Moderated inbox only — every other write stays forbidden for guests.
          if (method === 'POST' && SHARE_GUEST_SUBMIT_PATH.test(c.req.path)) {
            await next();
            return;
          }
          return c.json({ error: 'forbidden' }, 403);
        }
        if (!hasAnyWritePermission(ctx.permission)) {
          return c.json({ error: 'forbidden' }, 403);
        }
      }
    }
    await next();
  };
}
