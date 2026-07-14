import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgRole } from '@plandesk/db';
import { hasAtLeast } from './permissions.js';

/**
 * Request-scoped auth. Middleware resolves org + effective permission once,
 * whatever the transport; services read `orgId` and call requireRole and must
 * never branch on `kind`. Three transports, one identity model:
 * browser session cookie, CLI/agent token, and trusted loopback.
 */
export type AuthContext =
  | {
      kind: 'session';
      orgId: string;
      /** Stable identity, e.g. `github:<numeric id>` — never the login. */
      userRef: string;
      /** The member's role: a browser session has no scope ceiling above it. */
      permission: OrgRole;
    }
  | {
      kind: 'token';
      orgId: string;
      /** Effective permission: lesser of member role and token scope ceiling. */
      permission: OrgRole;
    }
  | {
      kind: 'loopback';
      orgId: string;
      /** REQ-21: local loopback single-org is always owner — no login. */
      permission: 'owner';
    };

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

export function tryGetAuthContext(): AuthContext | undefined {
  return storage.getStore();
}

export class ReadOnlyTokenError extends Error {
  constructor() {
    super('read-only token cannot perform write operations');
    this.name = 'ReadOnlyTokenError';
  }
}

/** Reject pure read-only callers (viewer / read-only token). */
export function assertWriteAccess(): void {
  if (!hasAtLeast(getAuthContext().permission, 'commenter')) {
    throw new ReadOnlyTokenError();
  }
}
