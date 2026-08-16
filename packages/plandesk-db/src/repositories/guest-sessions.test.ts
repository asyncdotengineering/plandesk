import { describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { createProjectInDefaultOrg as createProject } from '../testing.js';
import { createShare } from './shares.js';
import { createGuestSession, revokeGuestSession, verifyGuestSession } from './guest-sessions.js';

describe('guestSessions repository', () => {
  it('mints a guest session and verifies the raw token once', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Portal' });
    const { share } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Reviewers',
      mode: 'public',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });

    const { guest, token } = await createGuestSession(db, {
      shareId: share.id,
      projectId: project.id,
      name: 'Alex',
      email: 'alex@example.com',
    });

    expect(token.startsWith('plandesk_guest_')).toBe(true);
    expect(guest.name).toBe('Alex');
    expect(guest.email).toBe('alex@example.com');
    expect(guest.tokenHash).not.toBe(token);

    const verified = await verifyGuestSession(db, token);
    expect(verified?.id).toBe(guest.id);
    expect(verified?.shareId).toBe(share.id);
    expect(verified?.projectId).toBe(project.id);
    expect(verified?.share.id).toBe(share.id);
  });

  it('rejects unknown, revoked, and share-revoked tokens', async () => {
    const db = await createDb(':memory:');
    await migrate(db);
    const project = await createProject(db, { name: 'Portal' });
    const { share, token: shareToken } = await createShare(db, {
      projectId: project.id,
      audienceName: 'Reviewers',
      mode: 'public',
      permissions: { read: true, submit: false },
      policy: { tasks: 'all', documentIds: [], fields: {} },
    });
    void shareToken;

    const { guest, token } = await createGuestSession(db, {
      shareId: share.id,
      projectId: project.id,
      name: 'Alex',
    });

    expect(await verifyGuestSession(db, 'plandesk_guest_nope')).toBeUndefined();

    expect(await revokeGuestSession(db, guest.id)).toBe(true);
    expect(await verifyGuestSession(db, token)).toBeUndefined();
  });
});
