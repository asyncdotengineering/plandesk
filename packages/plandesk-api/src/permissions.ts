import type { OrgRole, TokenScope } from '@plandesk/db';

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
export function requireRole(ctx: { permission: OrgRole }, minimum: OrgRole): void {
  if (!hasAtLeast(ctx.permission, minimum)) {
    throw new InsufficientPermissionError(minimum, ctx.permission);
  }
}
