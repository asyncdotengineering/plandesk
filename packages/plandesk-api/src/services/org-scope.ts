import { getAuthContext, tryGetAuthContext } from '../auth-context.js';
import { PrincipalUnresolvedError, type Principal } from '../principal.js';
import { requirePermission, type PermissionSet } from '../permissions.js';
import {
  resolveWriteActorFromAuthContext,
  type WriteActor,
  WriteActorUnresolvedError,
} from '../write-actor.js';

export type OrgScopedDeps = {
  /** Explicit in-process caller when request auth context is absent. */
  principal?: Principal;
};

export function resolveOrgId(deps: OrgScopedDeps): string {
  if (deps.principal !== undefined) {
    return deps.principal.orgId;
  }
  const ctx = getAuthContext();
  if (ctx.kind === 'guest') {
    throw new Error('Guest context has no orgId');
  }
  return ctx.orgId;
}

/**
 * Effective permission set for this call.
 * Priority: principal → AuthContext → throw.
 */
export function resolvePermissionSet(deps: OrgScopedDeps): PermissionSet {
  if (deps.principal !== undefined) {
    return deps.principal.permission;
  }
  const ctx = tryGetAuthContext();
  if (ctx !== undefined && ctx.kind !== 'guest') {
    return ctx.permission;
  }
  if (ctx?.kind === 'guest') {
    return {};
  }
  throw new PrincipalUnresolvedError();
}

/** requirePermission against the caller's effective permission set (principal or AuthContext). */
export function assertPermission(deps: OrgScopedDeps, resource: string, action: string): void {
  requirePermission({ permission: resolvePermissionSet(deps) }, resource, action);
}

/**
 * Effective write actor for this call.
 * Priority: principal → AuthContext → throw.
 */
export function resolveWriteActor(deps: OrgScopedDeps): WriteActor {
  if (deps.principal !== undefined) {
    return deps.principal.actor;
  }
  const ctx = tryGetAuthContext();
  if (ctx !== undefined) {
    return resolveWriteActorFromAuthContext(ctx);
  }
  throw new WriteActorUnresolvedError();
}
