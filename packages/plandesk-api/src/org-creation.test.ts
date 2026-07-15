import { describe, expect, it } from 'vitest';
import {
  createOrg,
  createPendingAuth,
  createToken,
  ensureDefaultOrg,
  getPendingAuth,
  listOrgMembershipsForUser,
} from '@plandesk/db';
import { createTestApp, parseJson } from './test-helpers.js';
import type { FetchLike } from './github.js';

/**
 * An org may only come into existence by resolving an identity, or by
 * ensureDefaultOrg for the local/self-host single-org case. There is no
 * general create route: it had no caller, could not be org-guarded (no `:id`
 * to check the caller's org against), and took `owner_ref` from the body.
 */
describe('org creation has no general route', () => {
  it('POST /orgs is gone — an authenticated org-A token cannot mint an org', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0' });
    const orgA = await ensureDefaultOrg(db);
    const tokenA = await createToken(db, { name: 'A token', orgId: orgA.id, scope: 'full' });

    const res = await app.request('/api/v1/orgs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Squatted Org' }),
    });

    expect(res.status).toBe(404);
  });

  it('POST /orgs cannot forge an owner_ref for an identity the server should resolve', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0' });
    const orgA = await ensureDefaultOrg(db);
    const tokenA = await createToken(db, { name: 'A token', orgId: orgA.id, scope: 'full' });

    const res = await app.request('/api/v1/orgs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Forged', owner_ref: 'github:12345' }),
    });

    expect(res.status).toBe(404);
    // The forged identity owns nothing, because the route that would have
    // trusted the body no longer exists.
    expect(await listOrgMembershipsForUser(db, 'github:12345')).toEqual([]);
  });

  it('an org-B token still cannot mint a token for org-A (the guard the create route lacked)', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0' });
    const orgA = await ensureDefaultOrg(db);
    const orgB = await createOrg(db, { name: 'Org B' });
    const tokenB = await createToken(db, { name: 'B token', orgId: orgB.id, scope: 'full' });

    const res = await app.request(`/api/v1/orgs/${orgA.id}/tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'stolen', scope: 'full' }),
    });

    expect(res.status).toBe(404);
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

  it('a token minted against the default org authenticates with no GitHub app configured', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0' });
    const org = await ensureDefaultOrg(db);
    const token = await createToken(db, { name: 'self-host', orgId: org.id, scope: 'full' });

    const methods = await parseJson<{ method: string }>(await app.request('/api/v1/auth/methods'));
    expect(methods.method).toBe('token');

    const res = await app.request('/api/v1/projects', {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    expect(res.status).toBe(200);
  });
});

const deviceFetch: FetchLike = (url) =>
  Promise.resolve(
    new Response(
      JSON.stringify(
        String(url).includes('device/code')
          ? {
              device_code: 'secret',
              user_code: 'CODE',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
            }
          : { error: 'authorization_pending' },
      ),
      { status: 200 },
    ),
  );

const githubConfig = {
  clientId: 'client',
  clientSecret: 'secret',
  callbackUrl: 'https://x.test/cb',
  fetch: deviceFetch,
};

describe('pending_auth does not leak', () => {
  it('sweeps expired rows on start — an abandoned login is never polled again', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0', github: githubConfig });

    // A login that was started and then abandoned: expired, and nothing will
    // ever poll this auth_id again, so the poll path cannot reach it.
    await createPendingAuth(db, {
      authId: 'abandoned',
      deviceCode: 'dead',
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await getPendingAuth(db, 'abandoned')).toBeDefined();

    await app.request('/api/v1/auth/device/start', { method: 'POST' });

    expect(await getPendingAuth(db, 'abandoned')).toBeUndefined();
  });

  it('leaves live rows alone — a login in progress must survive someone else starting one', async () => {
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0', github: githubConfig });

    await createPendingAuth(db, {
      authId: 'in-flight',
      deviceCode: 'live',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await app.request('/api/v1/auth/device/start', { method: 'POST' });

    expect(await getPendingAuth(db, 'in-flight')).toBeDefined();
  });
});
