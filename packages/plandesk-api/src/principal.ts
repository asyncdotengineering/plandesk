import type { OrgRole } from '@plandesk/db';
import { orgRoleToPermissionSet, type PermissionSet } from './permissions.js';
import type { WriteActor } from './write-actor.js';

/** Explicit in-process caller identity when request auth context is absent. */
export type Principal = {
  orgId: string;
  permission: PermissionSet;
  actor: WriteActor;
};

export class PrincipalUnresolvedError extends Error {
  constructor() {
    super('No principal or auth context');
    this.name = 'PrincipalUnresolvedError';
  }
}

/**
 * An in-process caller with an explicit access level — a role or a permission
 * set. The access level is required: nothing here defaults to owner.
 */
export function localPrincipal(
  orgId: string,
  access: OrgRole | PermissionSet,
  actor: WriteActor = { kind: 'system' },
): Principal {
  const permission = typeof access === 'string' ? orgRoleToPermissionSet(access) : access;
  return { orgId, permission, actor };
}

/** The machine owner acting through the CLI (or a test standing in for it). */
export function localOwner(orgId: string): Principal {
  return localPrincipal(orgId, 'owner');
}
