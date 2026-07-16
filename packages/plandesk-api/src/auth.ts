import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import {
  getDefaultOrg,
  getOrgMember,
  isSingleOrg,
  verifySession,
  verifyToken,
  type Db,
  type OrgRole,
  type TokenScope,
} from '@plandesk/db';
import {
  applyAgentKeyPermissionCeiling,
  verifyBetterAuthApiKey,
} from './agent-keys.js';
import { runWithAuthContext, tryGetAuthContext, type AuthContext } from './auth-context.js';
import type { BetterAuthInstance } from './better-auth.js';
import { userRefFromGithubAccountId } from './identity.js';
import {
  effectivePermission,
  hasAnyWritePermission,
  orgRoleToPermissionSet,
  resolveEffectivePermissionSet,
} from './permissions.js';
import { readSessionCookie } from './session.js';

const BASIC_PREFIX = 'Basic ';
const BASIC_USER = 'plandesk';
const BEARER_PREFIX = 'Bearer ';
const GITHUB_PROVIDER_ID = 'github';

/** Optional actor for member-role resolution (does not elevate; only restricts). */
export const USER_REF_HEADER = 'X-Plandesk-User-Ref';

export type AppVariables = {
  orgId: string;
  tokenScope: TokenScope;
};

type BetterAuthAccountRow = {
  accountId: string;
  providerId: string;
  userId: string;
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
  return timingSafeEqual(provided, expected);
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
   * are recognized here; omit and only token / hand-rolled session / loopback apply.
   */
  betterAuth?: BetterAuthInstance;
};

/**
 * BA2 better-auth ladder roles → plandesk OrgRole for AuthContext + permission sets.
 * member → editor, admin → manager (BA3b permission-set equivalence).
 */
function betterAuthRoleToOrgRole(role: string): OrgRole | undefined {
  switch (role) {
    case 'owner':
      return 'owner';
    case 'admin':
      return 'manager';
    case 'member':
      return 'editor';
    default:
      return undefined;
  }
}

/**
 * Resolve a better-auth session into AuthContext.
 * - null session → undefined (caller falls through to hand-rolled / loopback)
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

  const active = members[0];
  if (active === undefined) {
    return 'unauthorized';
  }
  const role = betterAuthRoleToOrgRole(active.role);
  if (role === undefined) {
    return 'unauthorized';
  }

  const account = await adapter.findOne<BetterAuthAccountRow>({
    model: 'account',
    where: [
      { field: 'userId', value: userId },
      { field: 'providerId', value: GITHUB_PROVIDER_ID },
    ],
  });
  if (account === null) {
    return 'unauthorized';
  }
  let userRef: string;
  try {
    userRef = userRefFromGithubAccountId(account.accountId);
  } catch {
    return 'unauthorized';
  }

  return {
    kind: 'session',
    orgId: active.organizationId,
    userRef,
    role,
    permission: orgRoleToPermissionSet(role),
  };
}

/**
 * Resolve member role for this request.
 * - No X-Plandesk-User-Ref: treat as owner (org-level token / local user).
 * - Header present: look up org_members; unknown user_ref → 403.
 */
async function resolveMemberRole(
  db: Db,
  orgId: string,
  userRefHeader: string | undefined,
): Promise<OrgRole | 'forbidden'> {
  if (userRefHeader === undefined) {
    return 'owner';
  }
  const userRef = userRefHeader.trim();
  if (userRef === '') {
    return 'forbidden';
  }
  const member = await getOrgMember(db, orgId, userRef);
  if (member === undefined) {
    return 'forbidden';
  }
  return member.role;
}

type ApiKeyMetadata = {
  projectId?: unknown;
  orgId?: unknown;
};

function readApiKeyMetadata(metadata: unknown): {
  orgId: string | undefined;
  projectId: string | undefined;
} {
  if (metadata === null || metadata === undefined || typeof metadata !== 'object') {
    return { orgId: undefined, projectId: undefined };
  }
  const m = metadata as ApiKeyMetadata;
  return {
    orgId: typeof m.orgId === 'string' && m.orgId.length > 0 ? m.orgId : undefined,
    projectId:
      typeof m.projectId === 'string' && m.projectId.length > 0 ? m.projectId : undefined,
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
  return betterAuthRoleToOrgRole(active.role);
}

/**
 * Try better-auth API key first (BA5). Returns:
 * - AuthContext when the bearer is a valid better-auth key with org metadata
 * - 'unauthorized' when the key is valid but unusable (no org)
 * - undefined when not a better-auth key (caller falls through to mcp_tokens)
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
  const { orgId, projectId } = readApiKeyMetadata(verified.metadata);
  if (orgId === undefined) {
    return 'unauthorized';
  }

  const liveRole = await resolveBetterAuthLiveRole(auth, userId, orgId);
  const permission = applyAgentKeyPermissionCeiling(verified.permissions, liveRole);
  // role for ladder call sites: live role when present, else viewer (empty ceiling).
  const role: OrgRole = liveRole ?? 'viewer';

  return {
    kind: 'apikey',
    orgId,
    userId,
    ...(projectId !== undefined ? { projectId } : {}),
    role,
    permission,
  };
}

/**
 * Endpoints that must answer before the caller holds a credential: the OAuth
 * entry/callback (GitHub sends the browser here with no cookie), the method
 * probe the sign-in UI reads, logout (which authenticates itself off the
 * cookie it is destroying), and better-auth's own sign-in surface at /api/auth/*
 * (chicken-and-egg: cannot require a token to obtain one).
 */
const PUBLIC_AUTH_PATHS = new Set([
  '/api/v1/auth/github',
  '/api/v1/auth/github/callback',
  '/api/v1/auth/methods',
  '/api/v1/auth/device/start',
  '/api/v1/auth/device/poll',
  '/api/v1/auth/logout',
  '/api/auth/*',
]);

export function isPublicAuthPath(path: string): boolean {
  if (PUBLIC_AUTH_PATHS.has(path)) {
    return true;
  }
  // better-auth mounts under /api/auth/*; the set holds the prefix pattern.
  return path === '/api/auth' || path.startsWith('/api/auth/');
}

/**
 * Share-token reads under /api/v1/share/. The capability is the URL token, not an
 * org membership: each route resolves exactly one share → one project and reads
 * only that project (buildClientView), so no org context is needed or set. This
 * keeps the portal an unauthenticated read surface without widening org access —
 * a share token can never resolve to an orgId or another project. (Share *creation*
 * lives under /tasks/:id/share and /documents/:id/share, outside this prefix.)
 */
export function isPublicShareReadPath(path: string): boolean {
  return path.startsWith('/api/v1/share/');
}

/**
 * Always-on org resolver for every request:
 * 1. Bearer → better-auth API key (BA5 live-role ceiling) when configured
 * 2. else Bearer → mcp_tokens verifyToken (unchanged until BA7)
 * 3. else better-auth session cookie → active org + member role (when configured)
 * 4. else hand-rolled session cookie → session.orgId + the member's role
 * 5. else loopback bind + single-org → default org as owner (local, zero friction)
 * 6. else 401
 *
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

    const bearer = extractBearerToken(c.req.header('Authorization'));
    if (bearer !== undefined) {
      if (betterAuth !== undefined) {
        const apiKeyCtx = await resolveBetterAuthApiKeyContext(betterAuth, bearer);
        if (apiKeyCtx === 'unauthorized') {
          return c.json({ error: 'unauthorized' }, 401);
        }
        if (apiKeyCtx !== undefined) {
          await runWithAuthContext(apiKeyCtx, async () => {
            await next();
          });
          return;
        }
      }

      const verified = await verifyToken(db, bearer);
      if (verified === undefined) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const memberRole = await resolveMemberRole(db, verified.orgId, c.req.header(USER_REF_HEADER));
      if (memberRole === 'forbidden') {
        return c.json({ error: 'forbidden' }, 403);
      }
      const role = effectivePermission(memberRole, verified.scope);
      const ctx: AuthContext = {
        kind: 'token',
        orgId: verified.orgId,
        role,
        permission: resolveEffectivePermissionSet(memberRole, verified.scope),
      };
      await runWithAuthContext(ctx, async () => {
        await next();
      });
      return;
    }

    if (betterAuth !== undefined) {
      const betterAuthCtx = await resolveBetterAuthSessionContext(betterAuth, c.req.raw.headers);
      if (betterAuthCtx === 'unauthorized') {
        return c.json({ error: 'unauthorized' }, 401);
      }
      if (betterAuthCtx !== undefined) {
        await runWithAuthContext(betterAuthCtx, async () => {
          await next();
        });
        return;
      }
    }

    const sessionToken = readSessionCookie(c);
    if (sessionToken !== undefined) {
      const session = await verifySession(db, sessionToken);
      if (session === undefined) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const member = await getOrgMember(db, session.orgId, session.userRef);
      if (member === undefined) {
        // Membership was revoked after the session was minted: the cookie no
        // longer carries any authority, so the caller must sign in again.
        return c.json({ error: 'unauthorized' }, 401);
      }
      // A browser session has no scope ceiling — the member's role IS the
      // permission, enforced downstream by the same requireRole as tokens.
      const ctx: AuthContext = {
        kind: 'session',
        orgId: session.orgId,
        userRef: session.userRef,
        role: member.role,
        permission: orgRoleToPermissionSet(member.role),
      };
      await runWithAuthContext(ctx, async () => {
        await next();
      });
      return;
    }

    if (isLoopbackBind(bindHost) && (await isSingleOrg(db))) {
      const org = await getDefaultOrg(db);
      if (org !== undefined) {
        // REQ-21: local loopback single-org is always owner — no login, no role prompt.
        const ctx: AuthContext = {
          kind: 'loopback',
          orgId: org.id,
          role: 'owner',
          permission: orgRoleToPermissionSet('owner'),
        };
        await runWithAuthContext(ctx, async () => {
          await next();
        });
        return;
      }
    }

    return c.json({ error: 'unauthorized' }, 401);
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

    // OAuth entry/callback must stay reachable: GitHub redirects the browser
    // here and cannot present Basic credentials.
    if (isPublicAuthPath(c.req.path) || isPublicShareReadPath(c.req.path)) {
      await next();
      return;
    }

    // Bearer tokens are handled by org auth; do not require Basic on top of them.
    if (extractBearerToken(c.req.header('Authorization')) !== undefined) {
      await next();
      return;
    }

    // A session cookie is a stronger credential than the shared front-door
    // password; a signed-in member should not be asked for it as well.
    if (readSessionCookie(c) !== undefined) {
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
 * Reject pure read-only callers (viewer / read-only token) on write HTTP methods.
 * Finer roles (commenter vs editor) are enforced in services via requirePermission.
 */
export function createWriteGuardMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const ctx = tryGetAuthContext();
      if (ctx !== undefined && !hasAnyWritePermission(ctx.permission)) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }
    await next();
  };
}
