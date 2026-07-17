import { describe, expect, it } from 'vitest';
import {
  hasAnyWritePermission,
  hasPermission,
  orgRoleToPermissionSet,
  PermissionDeniedError,
  requirePermission,
} from './permissions.js';

describe('permissions model', () => {
  it('maps owner/admin/member directly to access-control statements', () => {
    const ownerSet = orgRoleToPermissionSet('owner');
    const adminSet = orgRoleToPermissionSet('admin');
    const memberSet = orgRoleToPermissionSet('member');

    expect(hasPermission(memberSet, 'task', 'update')).toBe(true);
    expect(hasPermission(memberSet, 'project', 'create')).toBe(false);
    expect(hasPermission(adminSet, 'project', 'create')).toBe(true);
    expect(hasPermission(adminSet, 'member', 'create')).toBe(false);
    expect(hasPermission(ownerSet, 'member', 'create')).toBe(true);
    expect(hasPermission(ownerSet, 'apiKey', 'create')).toBe(true);
  });

  it('requirePermission throws PermissionDeniedError when action is missing', () => {
    const memberSet = orgRoleToPermissionSet('member');
    expect(() => requirePermission({ permission: memberSet }, 'project', 'create')).toThrow(
      PermissionDeniedError,
    );
    expect(() => requirePermission({ permission: memberSet }, 'task', 'update')).not.toThrow();
  });

  it('empty permission set is read-only', () => {
    expect(hasAnyWritePermission({})).toBe(false);
    expect(hasAnyWritePermission(orgRoleToPermissionSet('member'))).toBe(true);
  });
});
