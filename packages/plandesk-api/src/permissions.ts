import type { OrgRole, TokenScope } from '@plandesk/db';
import {
  admin,
  intersectPermissions,
  member,
  owner,
  type statement,
} from './access-control.js';

export type PermissionSet = Record<string, readonly string[]>;
export type PermissionResource = keyof typeof statement;
export type WorkAction = (typeof statement)['task'][number];

const workActions = ['read', 'create', 'update', 'delete'] as const;
const writeActions = new Set<string>(['create', 'update', 'delete']);

export const viewerPermissionSet: PermissionSet = {};

export const commenterPermissionSet: PermissionSet = {
  comment: workActions,
};

export function orgRoleToPermissionSet(role: OrgRole): PermissionSet {
  switch (role) {
    case 'viewer':
      return viewerPermissionSet;
    case 'commenter':
      return commenterPermissionSet;
    case 'editor':
      return member.statements;
    case 'manager':
      return admin.statements;
    case 'owner':
      return owner.statements;
  }
}

export function resolveEffectivePermissionSet(
  memberRole: OrgRole,
  tokenScope: TokenScope,
): PermissionSet {
  const roleSet = orgRoleToPermissionSet(memberRole);
  if (tokenScope === 'full') {
    return roleSet;
  }
  return intersectPermissions(roleSet, viewerPermissionSet);
}

export function hasPermission(
  permissions: PermissionSet,
  resource: string,
  action: string,
): boolean {
  const actions = permissions[resource];
  return actions !== undefined && actions.includes(action);
}

export function hasAnyWritePermission(permissions: PermissionSet): boolean {
  for (const actions of Object.values(permissions)) {
    if (actions.some((action) => writeActions.has(action))) {
      return true;
    }
  }
  return false;
}

/** Thrown when the caller lacks a specific resource:action → HTTP 403. */
export class PermissionDeniedError extends Error {
  readonly resource: string;
  readonly action: string;

  constructor(resource: string, action: string) {
    super(`requires ${resource}:${action}`);
    this.name = 'PermissionDeniedError';
    this.resource = resource;
    this.action = action;
  }
}

export function requirePermission(
  ctx: { permission: PermissionSet },
  resource: string,
  action: string,
): void {
  if (!hasPermission(ctx.permission, resource, action)) {
    throw new PermissionDeniedError(resource, action);
  }
}

/**
 * Role ladder (low → high). Effective permission is the lesser of member role
 * and the ceiling implied by token scope.
 */
export const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  manager: 3,
  owner: 4,
};

/** Token scope as a ceiling on the role ladder. */
export function scopeCeiling(scope: TokenScope): OrgRole {
  return scope === 'read-only' ? 'viewer' : 'owner';
}

/** Lesser of two roles on the ladder. */
export function lesserRole(a: OrgRole, b: OrgRole): OrgRole {
  return ROLE_RANK[a] <= ROLE_RANK[b] ? a : b;
}

/**
 * Effective permission = min(memberRole, tokenScopeCeiling).
 * A full token never elevates a viewer; a read-only token never elevates an owner.
 */
export function effectivePermission(memberRole: OrgRole, tokenScope: TokenScope): OrgRole {
  return lesserRole(memberRole, scopeCeiling(tokenScope));
}

export function hasAtLeast(permission: OrgRole, minimum: OrgRole): boolean {
  return ROLE_RANK[permission] >= ROLE_RANK[minimum];
}

/** Thrown when the caller is authenticated but lacks the required role → HTTP 403. */
export class InsufficientPermissionError extends Error {
  readonly minimum: OrgRole;
  readonly actual: OrgRole;

  constructor(minimum: OrgRole, actual: OrgRole) {
    super(`requires role ${minimum}, have ${actual}`);
    this.name = 'InsufficientPermissionError';
    this.minimum = minimum;
    this.actual = actual;
  }
}

/**
 * Deny when effective permission is below `minimum`.
 * Pass the request auth context (or any `{ permission }` object).
 */
export function requireRole(
  ctx: { permission: OrgRole } | { role: OrgRole },
  minimum: OrgRole,
): void {
  const actual = 'role' in ctx ? ctx.role : ctx.permission;
  if (!hasAtLeast(actual, minimum)) {
    throw new InsufficientPermissionError(minimum, actual);
  }
}
