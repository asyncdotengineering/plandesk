import { AsyncLocalStorage } from 'node:async_hooks';
import type { TokenScope } from '@plandesk/db';

export type AuthContext = {
  orgId: string;
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

export function assertWriteAccess(): void {
  if (getAuthContext().tokenScope === 'read-only') {
    throw new ReadOnlyTokenError();
  }
}
