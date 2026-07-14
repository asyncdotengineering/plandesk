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
import { runWithAuthContext, tryGetAuthContext, type AuthContext } from './auth-context.js';
import { effectivePermission, hasAtLeast } from './permissions.js';
import { readSessionCookie } from './session.js';

const BASIC_PREFIX = 'Basic ';
const BASIC_USER = 'plandesk';
const BEARER_PREFIX = 'Bearer ';

/** Optional actor for member-role resolution (does not elevate; only restricts). */
export const USER_REF_HEADER = 'X-Plandesk-User-Ref';

export type AppVariables = {
  orgId: string;
  tokenScope: TokenScope;
  permission: OrgRole;
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
};

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

/**
 * Endpoints that must answer before the caller holds a credential: the OAuth
 * entry/callback (GitHub sends the browser here with no cookie), the method
 * probe the sign-in UI reads, and logout (which authenticates itself off the
 * cookie it is destroying).
 */
const PUBLIC_AUTH_PATHS = new Set([
  '/api/v1/auth/github',
  '/api/v1/auth/github/callback',
  '/api/v1/auth/methods',
  '/api/v1/auth/logout',
]);

export function isPublicAuthPath(path: string): boolean {
  return PUBLIC_AUTH_PATHS.has(path);
}

/**
 * Always-on org resolver for every request:
 * 1. Bearer token → token.orgId + effective permission
 * 2. else session cookie → session.orgId + the member's role
 * 3. else loopback bind + single-org → default org as owner (local, zero friction)
 * 4. else 401
 *
 * Every branch yields the same `{ orgId, permission }`, so services downstream
 * are identical for a browser, the CLI, and an agent.
 */
export function createOrgAuthMiddleware(options: OrgAuthOptions): MiddlewareHandler {
  const { db, bindHost } = options;

  return async (c, next) => {
    if (isPublicAuthPath(c.req.path)) {
      await next();
      return;
    }

    const bearer = extractBearerToken(c.req.header('Authorization'));
    if (bearer !== undefined) {
      const verified = await verifyToken(db, bearer);
      if (verified === undefined) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const memberRole = await resolveMemberRole(db, verified.orgId, c.req.header(USER_REF_HEADER));
      if (memberRole === 'forbidden') {
        return c.json({ error: 'forbidden' }, 403);
      }
      const permission = effectivePermission(memberRole, verified.scope);
      const ctx: AuthContext = {
        kind: 'token',
        orgId: verified.orgId,
        permission,
      };
      await runWithAuthContext(ctx, async () => {
        await next();
      });
      return;
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
        permission: member.role,
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
          permission: 'owner',
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
    if (isPublicAuthPath(c.req.path)) {
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
 * Finer roles (commenter vs editor) are enforced in services via requireRole.
 */
export function createWriteGuardMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const ctx = tryGetAuthContext();
      if (ctx !== undefined && !hasAtLeast(ctx.permission, 'commenter')) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }
    await next();
  };
}
