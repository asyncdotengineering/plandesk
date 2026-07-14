import type { OrgRole } from '@plandesk/db';
import { getAuthContext, tryGetAuthContext } from '../auth-context.js';
import { requireRole } from '../permissions.js';

export type OrgScopedDeps = {
  /** Fixed org scope for unit tests; production uses request auth context. */
  orgId?: string;
  /**
   * Fixed permission for unit tests. Production uses AuthContext.permission.
   * When orgId is injected without permission (legacy unit-test path), defaults
   * to owner so role checks do not require a full request context.
   */
  permission?: OrgRole;
};

export function resolveOrgId(deps: OrgScopedDeps): string {
  return deps.orgId ?? getAuthContext().orgId;
}

/**
 * Effective permission for this call.
 * Priority: deps.permission → AuthContext.permission → owner (service unit tests
 * that invoke methods without request middleware; production always has context).
 */
export function resolvePermission(deps: OrgScopedDeps): OrgRole {
  if (deps.permission !== undefined) {
    return deps.permission;
  }
  const ctx = tryGetAuthContext();
  if (ctx !== undefined) {
    return ctx.permission;
  }
  return 'owner';
}

/** requireRole against the caller's effective permission (deps or AuthContext). */
export function assertPermission(deps: OrgScopedDeps, minimum: OrgRole): void {
  requireRole({ permission: resolvePermission(deps) }, minimum);
}
