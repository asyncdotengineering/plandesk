import { describe, expect, it } from 'vitest';
import {
  applyAgentKeyPermissionCeiling,
  DEFAULT_AGENT_KEY_PERMISSIONS,
  DEFAULT_OWNER_KEY_PERMISSIONS,
} from './agent-keys.js';
import { hasPermission, orgRoleToPermissionSet } from './permissions.js';

describe('applyAgentKeyPermissionCeiling', () => {
  it('intersects key permissions with live role and always strips apiKey', () => {
    const keyPerms = {
      task: ['read', 'update'],
      apiKey: ['create', 'read'],
      member: ['create'],
      project: ['create'],
    };
    const effective = applyAgentKeyPermissionCeiling(keyPerms, 'owner');
    expect(hasPermission(effective, 'task', 'read')).toBe(true);
    expect(hasPermission(effective, 'task', 'update')).toBe(true);
    expect(hasPermission(effective, 'apiKey', 'create')).toBe(false);
    expect(hasPermission(effective, 'member', 'create')).toBe(true);
    expect(hasPermission(effective, 'project', 'create')).toBe(true);
  });

  it('caps at live member role (owner-minted key after demotion)', () => {
    const keyPerms = {
      task: ['read', 'create', 'update', 'delete'],
      project: ['create', 'delete'],
      member: ['create'],
      apiKey: ['create'],
    };
    const effective = applyAgentKeyPermissionCeiling(keyPerms, 'editor');
    expect(hasPermission(effective, 'task', 'update')).toBe(true);
    expect(hasPermission(effective, 'project', 'create')).toBe(false);
    expect(hasPermission(effective, 'member', 'create')).toBe(false);
    expect(hasPermission(effective, 'apiKey', 'create')).toBe(false);
  });

  it('no member row → empty permissions (property 4)', () => {
    const keyPerms = orgRoleToPermissionSet('owner');
    const effective = applyAgentKeyPermissionCeiling(keyPerms, undefined);
    expect(effective).toEqual({});
    expect(hasPermission(effective, 'task', 'read')).toBe(false);
  });

  it('default agent grant has empty member/organization/apiKey', () => {
    expect(DEFAULT_AGENT_KEY_PERMISSIONS.member).toEqual([]);
    expect(DEFAULT_AGENT_KEY_PERMISSIONS.organization).toEqual([]);
    expect(DEFAULT_AGENT_KEY_PERMISSIONS.apiKey).toEqual([]);
    expect(hasPermission(DEFAULT_AGENT_KEY_PERMISSIONS, 'task', 'update')).toBe(true);
    expect(hasPermission(DEFAULT_AGENT_KEY_PERMISSIONS, 'project', 'create')).toBe(true);
  });

  it('owner profile retains apiKey when live role is owner (BA4b-1)', () => {
    const keyPerms = {
      task: ['read', 'update'],
      apiKey: ['create', 'read'],
      member: ['create'],
    };
    const effective = applyAgentKeyPermissionCeiling(keyPerms, 'owner', 'owner');
    expect(hasPermission(effective, 'apiKey', 'create')).toBe(true);
    expect(hasPermission(effective, 'member', 'create')).toBe(true);
    expect(hasPermission(effective, 'task', 'read')).toBe(true);
  });

  it('owner profile still intersects live role (demoted → no apiKey)', () => {
    const keyPerms = DEFAULT_OWNER_KEY_PERMISSIONS;
    const effective = applyAgentKeyPermissionCeiling(keyPerms, 'editor', 'owner');
    expect(hasPermission(effective, 'task', 'update')).toBe(true);
    expect(hasPermission(effective, 'apiKey', 'create')).toBe(false);
    expect(hasPermission(effective, 'member', 'create')).toBe(false);
    expect(hasPermission(effective, 'project', 'create')).toBe(false);
  });

  it('owner profile with no member row → empty', () => {
    const effective = applyAgentKeyPermissionCeiling(
      DEFAULT_OWNER_KEY_PERMISSIONS,
      undefined,
      'owner',
    );
    expect(effective).toEqual({});
  });

  it('explicit agent kind strips apiKey same as default', () => {
    const keyPerms = { apiKey: ['create'], task: ['read'] };
    const defaulted = applyAgentKeyPermissionCeiling(keyPerms, 'owner');
    const explicit = applyAgentKeyPermissionCeiling(keyPerms, 'owner', 'agent');
    expect(hasPermission(defaulted, 'apiKey', 'create')).toBe(false);
    expect(hasPermission(explicit, 'apiKey', 'create')).toBe(false);
    expect(hasPermission(DEFAULT_OWNER_KEY_PERMISSIONS, 'apiKey', 'create')).toBe(true);
  });
});
