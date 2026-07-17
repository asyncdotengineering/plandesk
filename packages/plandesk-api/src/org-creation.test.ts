import { describe, expect, it } from 'vitest';
import {
  ensureDefaultOrg,
  listOrgMembershipsForUser,
} from '@plandesk/db';
import { createTestApp, parseJson } from './test-helpers.js';

/**
 * An org may only come into existence by resolving an identity (better-auth),
 * or by ensureDefaultOrg for the local/self-host single-org case. There is no
 * general create route.
 */
describe('org creation has no general route', () => {
  it('POST /orgs is gone — loopback owner cannot mint an org via REST', async () => {
    const { app } = await createTestApp({ bindHost: '127.0.0.1' });

    const res = await app.request('/api/v1/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Squatted Org' }),
    });

    expect(res.status).toBe(404);
  });

  it('POST /orgs cannot forge an owner_ref for an identity the server should resolve', async () => {
    const { app, db } = await createTestApp({ bindHost: '127.0.0.1' });

    const res = await app.request('/api/v1/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Forged', owner_ref: 'github:12345' }),
    });

    expect(res.status).toBe(404);
    expect(await listOrgMembershipsForUser(db, 'github:12345')).toEqual([]);
  });
});

/**
 * REQ-20: a self-hoster must reach a first org without registering a GitHub
 * app — which is what makes deleting POST /orgs safe. ensureDefaultOrg at
 * serve boot is that path, and it must not depend on any route.
 */
describe('bootstrap without GitHub survives the deletion', () => {
  it('ensureDefaultOrg yields exactly one org, and is idempotent', async () => {
    const { db } = await createTestApp();
    const first = await ensureDefaultOrg(db);
    const again = await ensureDefaultOrg(db);
    expect(again.id).toBe(first.id);
  });

  it('loopback owner authenticates with no GitHub app configured', async () => {
    const { app } = await createTestApp({ bindHost: '127.0.0.1' });

    const methods = await parseJson<{ method: string; githubEnabled: boolean }>(
      await app.request('/api/v1/auth/methods'),
    );
    expect(methods.method).toBe('token');
    expect(methods.githubEnabled).toBe(false);

    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(200);
  });
});
