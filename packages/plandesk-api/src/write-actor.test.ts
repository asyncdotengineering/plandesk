import { describe, expect, it } from 'vitest';
import { runWithAuthContext } from './auth-context.js';
import { DEFAULT_AGENT_KEY_PERMISSIONS, DEFAULT_OWNER_KEY_PERMISSIONS } from './agent-keys.js';
import { orgRoleToPermissionSet } from './permissions.js';
import { resolveWriteActor } from './services/org-scope.js';
import {
  resolveWriteActorFromAuthContext,
  serializeActor,
  WriteActorUnresolvedError,
} from './write-actor.js';

describe('write-actor serialization', () => {
  it('writes the stored kind:id form for every variant', () => {
    expect(serializeActor({ kind: 'human', userId: 'user-abc' })).toBe('human:user-abc');
    expect(serializeActor({ kind: 'agent', runId: 'run-xyz' })).toBe('agent:run-xyz');
    expect(serializeActor({ kind: 'system' })).toBe('system');
  });
});

describe('resolveWriteActorFromAuthContext', () => {
  it('resolves session auth to the real user id', () => {
    const actor = resolveWriteActorFromAuthContext({
      kind: 'session',
      orgId: 'org-1',
      userRef: 'user:human-1',
      userId: 'human-1',
      role: 'owner',
      permission: DEFAULT_OWNER_KEY_PERMISSIONS,
      memberWorkspaceIds: [],
    });
    expect(actor).toEqual({ kind: 'human', userId: 'human-1' });
  });

  it('resolves loopback to system', () => {
    expect(
      resolveWriteActorFromAuthContext({
        kind: 'loopback',
        orgId: 'org-1',
        role: 'owner',
        permission: orgRoleToPermissionSet('owner'),
      }),
    ).toEqual({ kind: 'system' });
  });

  it('resolves agent apikey with an open run to the run id, not the owning user', () => {
    const actor = resolveWriteActorFromAuthContext({
      kind: 'apikey',
      orgId: 'org-1',
      userId: 'owner-user',
      profile: 'agent',
      role: 'owner',
      agentRunId: 'run-open',
      permission: DEFAULT_AGENT_KEY_PERMISSIONS,
    });
    expect(actor).toEqual({ kind: 'agent', runId: 'run-open' });
    expect(actor).not.toEqual({ kind: 'human', userId: 'owner-user' });
  });

  it('resolves owner apikey to the owning user id', () => {
    expect(
      resolveWriteActorFromAuthContext({
        kind: 'apikey',
        orgId: 'org-1',
        userId: 'owner-user',
        profile: 'owner',
        role: 'owner',
        permission: DEFAULT_OWNER_KEY_PERMISSIONS,
      }),
    ).toEqual({ kind: 'human', userId: 'owner-user' });
  });

  it('rejects agent apikey without an open run', () => {
    expect(() =>
      resolveWriteActorFromAuthContext({
        kind: 'apikey',
        orgId: 'org-1',
        userId: 'owner-user',
        profile: 'agent',
        role: 'owner',
        permission: DEFAULT_AGENT_KEY_PERMISSIONS,
      }),
    ).toThrow(WriteActorUnresolvedError);
  });
});

describe('resolveWriteActor via OrgScopedDeps', () => {
  it('uses principal actor in unit tests', () => {
    const actor = resolveWriteActor({
      principal: {
        orgId: 'org-1',
        permission: orgRoleToPermissionSet('owner'),
        actor: { kind: 'human', userId: 'injected' },
      },
    });
    expect(actor).toEqual({ kind: 'human', userId: 'injected' });
  });

  it('reads actor from auth context in production path', () => {
    const actor = runWithAuthContext(
      {
        kind: 'session',
        orgId: 'org-1',
        userRef: 'user:session-user',
        userId: 'session-user',
        role: 'member',
        permission: orgRoleToPermissionSet('member'),
        memberWorkspaceIds: [],
      },
      () => resolveWriteActor({}),
    );
    expect(actor).toEqual({ kind: 'human', userId: 'session-user' });
  });
});
