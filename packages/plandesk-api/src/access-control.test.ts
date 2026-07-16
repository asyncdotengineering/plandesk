import { describe, expect, it } from 'vitest';
import { admin, intersectPermissions, member, owner } from './access-control.js';

describe('better-auth access-control model', () => {
  it('authorizes the member, admin, and owner permission sets', () => {
    expect(member.authorize({ task: ['update'] }).success).toBe(true);
    expect(member.authorize({ project: ['create'] }).success).toBe(false);
    expect(member.authorize({ member: ['create'] }).success).toBe(false);
    expect(member.authorize({ apiKey: ['create'] }).success).toBe(false);

    expect(admin.authorize({ project: ['create'] }).success).toBe(true);
    expect(admin.authorize({ member: ['create'] }).success).toBe(false);

    expect(owner.authorize({ member: ['create'] }).success).toBe(true);
    expect(owner.authorize({ apiKey: ['create'] }).success).toBe(true);
    expect(owner.authorize({ team: ['create'] }).success).toBe(true);
  });

  it('intersects actions shared by both permission sets', () => {
    expect(
      intersectPermissions(
        { task: ['read', 'update'] },
        { task: ['read'], project: ['create'] },
      ),
    ).toEqual({ task: ['read'] });
  });

  it('returns no permissions when either permission set is empty', () => {
    expect(
      intersectPermissions({ task: ['read', 'update'], member: ['create'] }, {}),
    ).toEqual({});
    expect(intersectPermissions({}, { task: ['read'] })).toEqual({});
  });
});
