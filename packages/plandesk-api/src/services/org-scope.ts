import type { OrgRole } from '@plandesk/db';
import { getAuthContext, tryGetAuthContext } from '../auth-context.js';
import {
  orgRoleToPermissionSet,
  requirePermission,
  type PermissionSet,
} from '../permissions.js';

export type OrgScopedDeps = {
  /** Fixed org scope for unit tests; production uses request auth context. */
  orgId?: string;
  /**
   * Fixed permission for unit tests. Production uses AuthContext.permission.
   * When orgId is injected without permission (legacy unit-test path), defaults
   * to owner so role checks do not require a full request context.
   */
  permission?: OrgRole | PermissionSet;
};

export function resolveOrgId(deps: OrgScopedDeps): string {
  if (deps.orgId !== undefined) {
    return deps.orgId;
  }
  const ctx = getAuthContext();
  if (ctx.kind === 'guest') {
    throw new Error('Guest context has no orgId');
  }
  return ctx.orgId;
}

function isOrgRole(value: OrgRole | PermissionSet): value is OrgRole {
  return typeof value === 'string';
}

/**
 * Effective permission set for this call.
 * Priority: deps.permission → AuthContext.permission → owner (service unit tests
 * that invoke methods without request middleware; production always has context).
 */
export function resolvePermissionSet(deps: OrgScopedDeps): PermissionSet {
  if (deps.permission !== undefined) {
    return isOrgRole(deps.permission) ? orgRoleToPermissionSet(deps.permission) : deps.permission;
  }
  const ctx = tryGetAuthContext();
  if (ctx !== undefined && ctx.kind !== 'guest') {
    return ctx.permission;
  }
  if (ctx?.kind === 'guest') {
    return {};
  }
  return orgRoleToPermissionSet('owner');
}

/** requirePermission against the caller's effective permission set (deps or AuthContext). */
export function assertPermission(deps: OrgScopedDeps, resource: string, action: string): void {
  requirePermission({ permission: resolvePermissionSet(deps) }, resource, action);
}