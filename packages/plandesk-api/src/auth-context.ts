import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgRole } from '@plandesk/db';
import { hasAnyWritePermission, type PermissionSet } from './permissions.js';

/**
 * Request-scoped auth. Middleware resolves org + effective permission once,
 * whatever the transport; services read `orgId` and call requirePermission and
 * must never branch on `kind`. Three transports, one identity model:
 * browser session cookie, CLI/agent token, and trusted loopback.
 */
export type AuthContext =
  | {
      kind: 'session';
      orgId: string;
      /** Stable identity, e.g. `github:<numeric id>` — never the login. */
      userRef: string;
      /** Ladder role for display and requireRole. */
      role: OrgRole;
      /** Resolved permission set for resource:action checks. */
      permission: PermissionSet;
    }
  | {
      kind: 'token';
      orgId: string;
      /** Effective ladder role after token scope ceiling. */
      role: OrgRole;
      /** Intersected permission set for resource:action checks. */
      permission: PermissionSet;
    }
  | {
      kind: 'loopback';
      orgId: string;
      /** REQ-21: local loopback single-org is always owner — no login. */
      role: 'owner';
      permission: PermissionSet;
    }
  | {
      kind: 'apikey';
      orgId: string;
      /** better-auth user id that owns the key (referenceId). */
      userId: string;
      /** Optional project scope from key metadata; cross-project → 404. */
      projectId?: string;
      /**
       * Live member role when present (for requireRole ladder call sites).
       * Effective authority is always `permission` (key ∩ live role; agent
       * profile also strips apiKey — owner profile retains it when live role allows).
       */
      role: OrgRole;
      permission: PermissionSet;
    }
  | {
      /** Portal participant after join — no org membership, one share only. */
      kind: 'guest';
      shareId: string;
      projectId: string;
      guestSessionId: string;
    };

/** Org-bearing contexts (everything except portal guests). */
export type OrgAuthContext = Exclude<AuthContext, { kind: 'guest' }>;

export function isOrgAuthContext(ctx: AuthContext): ctx is OrgAuthContext {
  return ctx.kind !== 'guest';
}

const storage = new AsyncLocalStorage<AuthContext>();

export function runWithAuthContext<T>(ctx: AuthContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getAuthContext(): AuthContext {
  const ctx = storage.getStore();
  if (ctx === undefined) {
    throw new Error('Auth context is not set — org auth middleware must run first');
  }
  return ctx;
}

/** Org-bearing auth only — rejects portal guests (no org membership). */
export function getOrgAuthContext(): OrgAuthContext {
  const ctx = getAuthContext();
  if (!isOrgAuthContext(ctx)) {
    throw new Error('Guest context has no org membership');
  }
  return ctx;
}

export function tryGetAuthContext(): AuthContext | undefined {
  return storage.getStore();
}

export class ReadOnlyTokenError extends Error {
  constructor() {
    super('read-only token cannot perform write operations');
    this.name = 'ReadOnlyTokenError';
  }
}

/** Reject pure read-only callers (viewer / read-only token). Guests never write. */
export function assertWriteAccess(): void {
  const ctx = getAuthContext();
  if (ctx.kind === 'guest' || !hasAnyWritePermission(ctx.permission)) {
    throw new ReadOnlyTokenError();
  }
}
