import { describe, expect, it } from 'vitest';
import { admin, member, owner } from './access-control.js';
import {
  hasAnyWritePermission,
  hasPermission,
  orgRoleToPermissionSet,
  resolveEffectivePermissionSet,
} from './permissions.js';

describe('permission set ladder equivalence', () => {
  it('member denies project:create; admin allows project:create, denies member:create; owner allows member:create', () => {
    expect(member.authorize({ project: ['create'] }).success).toBe(false);
    expect(admin.authorize({ project: ['create'] }).success).toBe(true);
    expect(admin.authorize({ member: ['create'] }).success).toBe(false);
    expect(owner.authorize({ member: ['create'] }).success).toBe(true);
  });

  it('maps org ladder roles to the same allow/deny outcomes', () => {
    const editor = orgRoleToPermissionSet('editor');
    const manager = orgRoleToPermissionSet('manager');
    const ownerSet = orgRoleToPermissionSet('owner');

    expect(hasPermission(editor, 'task', 'create')).toBe(true);
    expect(hasPermission(editor, 'project', 'create')).toBe(false);
    expect(hasPermission(editor, 'member', 'create')).toBe(false);

    expect(hasPermission(manager, 'project', 'create')).toBe(true);
    expect(hasPermission(manager, 'member', 'create')).toBe(false);

    expect(hasPermission(ownerSet, 'member', 'create')).toBe(true);
    expect(hasPermission(ownerSet, 'apiKey', 'create')).toBe(true);
  });

  it('viewer and read-only tokens cannot write; commenter can comment only', () => {
    expect(hasAnyWritePermission(orgRoleToPermissionSet('viewer'))).toBe(false);
    expect(hasAnyWritePermission(orgRoleToPermissionSet('commenter'))).toBe(true);
    expect(hasPermission(orgRoleToPermissionSet('commenter'), 'comment', 'create')).toBe(true);
    expect(hasPermission(orgRoleToPermissionSet('commenter'), 'task', 'update')).toBe(false);

    const ownerReadOnly = resolveEffectivePermissionSet('owner', 'read-only');
    expect(hasAnyWritePermission(ownerReadOnly)).toBe(false);
    expect(hasPermission(ownerReadOnly, 'member', 'create')).toBe(false);
  });
});