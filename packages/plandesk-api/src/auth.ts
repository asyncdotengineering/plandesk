import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import {
  getDefaultOrg,
  isSingleOrg,
  verifyToken,
  type Db,
  type TokenScope,
} from '@plandesk/db';
import { runWithAuthContext, tryGetAuthContext, type AuthContext } from './auth-context.js';

const BASIC_PREFIX = 'Basic ';
const BASIC_USER = 'plandesk';
const BEARER_PREFIX = 'Bearer ';

export type AppVariables = {
  orgId: string;
  tokenScope: TokenScope;
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
 * Always-on org resolver for every request:
 * 1. Bearer token → token.orgId
 * 2. else loopback bind + single-org → default org (local, zero friction)
 * 3. else 401
 */
export function createOrgAuthMiddleware(options: OrgAuthOptions): MiddlewareHandler {
  const { db, bindHost } = options;

  return async (c, next) => {
    const bearer = extractBearerToken(c.req.header('Authorization'));
    if (bearer !== undefined) {
      const verified = await verifyToken(db, bearer);
      if (verified === undefined) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const ctx: AuthContext = { orgId: verified.orgId, tokenScope: verified.scope };
      await runWithAuthContext(ctx, async () => {
        await next();
      });
      return;
    }

    if (isLoopbackBind(bindHost) && (await isSingleOrg(db))) {
      const org = await getDefaultOrg(db);
      if (org !== undefined) {
        const ctx: AuthContext = { orgId: org.id, tokenScope: 'full' };
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

/** Reject write methods for read-only tokens with 403. */
export function createWriteGuardMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const ctx = tryGetAuthContext();
      if (ctx?.tokenScope === 'read-only') {
        return c.json({ error: 'forbidden' }, 403);
      }
    }
    await next();
  };
}
