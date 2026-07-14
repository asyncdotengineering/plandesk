import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgRole, TokenScope } from '@plandesk/db';
import { hasAtLeast } from './permissions.js';

/**
 * Request-scoped auth. Middleware resolves org + effective permission once;
 * services read this and call requireRole — they never branch on auth kind.
 */
export type AuthContext = {
  orgId: string;
  /** Effective permission: lesser of member role and token scope ceiling. */
  permission: OrgRole;
  tokenScope: TokenScope;
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
