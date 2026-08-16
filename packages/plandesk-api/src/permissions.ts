import type { OrgRole } from '@plandesk/db';
import { admin, member, owner, type statement } from './access-control.js';

export type PermissionSet = Record<string, readonly string[]>;
export type PermissionResource = keyof typeof statement;
export type WorkAction = (typeof statement)['task'][number];

const writeActions = new Set<string>(['create', 'update', 'delete']);

/** Map better-auth org role directly onto the access-control statement sets. */
export function orgRoleToPermissionSet(role: OrgRole): PermissionSet {
  switch (role) {
    case 'member':
      return member.statements;
    case 'admin':
      return admin.statements;
    case 'owner':
      return owner.statements;
  }
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
