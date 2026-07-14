import { describe, expect, it } from 'vitest';
import {
  effectivePermission,
  hasAtLeast,
  InsufficientPermissionError,
  lesserRole,
  requireRole,
  scopeCeiling,
} from './permissions.js';

describe('permissions model', () => {
  it('orders roles viewer < commenter < editor < manager < owner', () => {
    expect(hasAtLeast('viewer', 'viewer')).toBe(true);
    expect(hasAtLeast('commenter', 'viewer')).toBe(true);
    expect(hasAtLeast('viewer', 'commenter')).toBe(false);
    expect(hasAtLeast('editor', 'commenter')).toBe(true);
    expect(hasAtLeast('manager', 'editor')).toBe(true);
    expect(hasAtLeast('owner', 'manager')).toBe(true);
    expect(hasAtLeast('editor', 'manager')).toBe(false);
  });

  it('maps token scope to a role ceiling', () => {
    expect(scopeCeiling('read-only')).toBe('viewer');
    expect(scopeCeiling('full')).toBe('owner');
  });

  it('takes the lesser of member role and token scope', () => {
    expect(effectivePermission('owner', 'read-only')).toBe('viewer');
    expect(effectivePermission('viewer', 'full')).toBe('viewer');
    expect(effectivePermission('editor', 'full')).toBe('editor');
    expect(effectivePermission('commenter', 'full')).toBe('commenter');
    expect(effectivePermission('manager', 'read-only')).toBe('viewer');
    expect(lesserRole('owner', 'viewer')).toBe('viewer');
  });

  it('requireRole throws InsufficientPermissionError when below minimum', () => {
    expect(() => requireRole({ permission: 'viewer' }, 'editor')).toThrow(
      InsufficientPermissionError,
    );
    expect(() => requireRole({ permission: 'commenter' }, 'commenter')).not.toThrow();
    expect(() => requireRole({ permission: 'owner' }, 'manager')).not.toThrow();
  });
});
