import { describe, expect, it } from 'vitest';
import { admin, member, owner } from './access-control.js';
import { hasAnyWritePermission, hasPermission, orgRoleToPermissionSet } from './permissions.js';

describe('permission set ladder equivalence', () => {
  it('member denies project:create; admin allows project:create, denies member:create; owner allows member:create', () => {
    expect(member.authorize({ project: ['create'] }).success).toBe(false);
    expect(admin.authorize({ project: ['create'] }).success).toBe(true);
    expect(admin.authorize({ member: ['create'] }).success).toBe(false);
    expect(owner.authorize({ member: ['create'] }).success).toBe(true);
  });

  it('maps native org roles to the same allow/deny outcomes', () => {
    const memberSet = orgRoleToPermissionSet('member');
    const adminSet = orgRoleToPermissionSet('admin');
    const ownerSet = orgRoleToPermissionSet('owner');

    expect(hasPermission(memberSet, 'task', 'create')).toBe(true);
    expect(hasPermission(memberSet, 'project', 'create')).toBe(false);
    expect(hasPermission(memberSet, 'member', 'create')).toBe(false);

    expect(hasPermission(adminSet, 'project', 'create')).toBe(true);
    expect(hasPermission(adminSet, 'invitation', 'create')).toBe(true);
    expect(hasPermission(adminSet, 'member', 'create')).toBe(false);

    expect(hasPermission(ownerSet, 'member', 'create')).toBe(true);
    expect(hasPermission(ownerSet, 'apiKey', 'create')).toBe(true);
  });

  it('member has content write; empty set cannot write', () => {
    expect(hasAnyWritePermission(orgRoleToPermissionSet('member'))).toBe(true);
    expect(hasAnyWritePermission({})).toBe(false);
    expect(hasPermission(orgRoleToPermissionSet('member'), 'task', 'update')).toBe(true);
    expect(hasPermission(orgRoleToPermissionSet('member'), 'project', 'create')).toBe(false);
  });
});
