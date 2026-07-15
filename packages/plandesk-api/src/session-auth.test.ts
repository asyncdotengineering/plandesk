import { describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import {
  addOrgMember,
  createOrg,
  createProject,
  createToken,
  listOrgs,
  verifySession,
  type Db,
  type OrgRole,
} from '@plandesk/db';
import type { FetchLike, GithubConfig } from './github.js';
import { SESSION_COOKIE } from './session.js';
import { createTestApp, parseJson } from './test-helpers.js';

type GithubUser = { id: number; login: string; name: string | null };

/**
 * Stand-in for GitHub. Every test drives the real redirect flow through this —
 * the network is never touched.
 *
 * The account it reports is mutable, so a test can change what GitHub says
 * about the same numeric id (a rename) between sign-ins.
 */
function mockGithub(
  initialUser: GithubUser,
  overrides: Partial<GithubConfig> = {},
): { config: GithubConfig; setUser: (user: GithubUser) => void } {
  let user = initialUser;

  const json = (body: unknown): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  const doFetch: FetchLike = (url) => {
    if (url.includes('login/oauth/access_token')) {
      return json({ access_token: 'gho_test_token' });
    }
    if (url.includes('api.github.com/user')) {
      return json(user);
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  return {
    config: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      callbackUrl: 'https://plandesk.test/api/v1/auth/github/callback',
      dashboardUrl: '/',
      fetch: doFetch,
      ...overrides,
    },
    setUser: (next) => {
      user = next;
    },
  };
}

function cookieValue(setCookie: string | null, name: string): string | undefined {
  if (setCookie === null) {
    return undefined;
  }
  const match = new RegExp(`${name}=([^;]+)`).exec(setCookie);
  return match?.[1];
}

/** Drive the full browser flow exactly as a browser would: entry → GitHub → callback. */
async function signIn(app: Hono): Promise<{ cookie: string; setCookie: string; callback: Response }> {
  const start = await app.request('/api/v1/auth/github');
  expect(start.status).toBe(302);

  const location = start.headers.get('location');
  expect(location).toBeTruthy();
  const state = new URL(location ?? '').searchParams.get('state');
  expect(state).toBeTruthy();

  const stateCookie = cookieValue(start.headers.get('set-cookie'), 'plandesk_oauth_state');
  expect(stateCookie).toBeDefined();

  const callback = await app.request(
    `/api/v1/auth/github/callback?code=test-code&state=${encodeURIComponent(state ?? '')}`,
    { headers: { Cookie: `plandesk_oauth_state=${stateCookie ?? ''}` } },
  );

  const setCookie = callback.headers.get('set-cookie') ?? '';
  const session = cookieValue(setCookie, SESSION_COOKIE);
  expect(session).toBeDefined();
  return { cookie: `${SESSION_COOKIE}=${session ?? ''}`, setCookie, callback };
}

async function hostedApp(user: GithubUser, overrides: Partial<GithubConfig> = {}) {
  const { config, setUser } = mockGithub(user, overrides);
  // Non-loopback: the hosted path, where loopback owner-trust does not apply.
  const harness = await createTestApp({ bindHost: '0.0.0.0', github: config });
  return { ...harness, setGithubUser: setUser };
}

describe('web session auth — GitHub OAuth redirect', () => {
  it('a browser with no session gets 401 on the hosted API', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });

    const res = await app.request('/api/v1/projects');
    expect(res.status).toBe(401);
    expect(await parseJson(res)).toEqual({ error: 'unauthorized' });
  });

  it('a browser with a session gets 200', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const { cookie, callback } = await signIn(app);

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');

    const res = await app.request('/api/v1/projects', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  it('a session sees only its own org projects', async () => {
    const { app, db } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });

    const otherOrg = await createOrg(db, { name: 'Someone Else' });
    const otherProject = await createProject(db, { name: 'Not Yours', orgId: otherOrg.id });

    const { cookie } = await signIn(app);

    const created = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mine' }),
    });
    expect(created.status).toBe(201);

    const list = await parseJson<Array<{ id: string; name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: cookie } }),
    );
    expect(list.map((p) => p.name)).toEqual(['Mine']);
    expect(list.some((p) => p.id === otherProject.id)).toBe(false);

    const cross = await app.request(`/api/v1/projects/${otherProject.id}`, {
      headers: { Cookie: cookie },
    });
    expect(cross.status).toBe(404);
  });

  it('identity is the numeric id, not the login — a rename keeps the same org', async () => {
    const { app, db, setGithubUser } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const { cookie } = await signIn(app);
    const before = await parseJson<{ user_ref: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(before.user_ref).toBe('github:1');
    const orgsAfterFirst = (await listOrgs(db)).length;

    // The same GitHub account, now answering under a new login handle.
    setGithubUser({ id: 1, login: 'ada-renamed', name: 'Ada L' });
    const after = await signIn(app);
    const session = await parseJson<{ user_ref: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: after.cookie } }),
    );

    // Keyed on the id, so the rename neither changes identity nor orphans the org.
    expect(session.user_ref).toBe('github:1');
    expect(session.org.id).toBe(before.org.id);
    expect((await listOrgs(db)).length).toBe(orgsAfterFirst);
  });

  it('a second session for the same user_ref lands in the SAME org', async () => {
    const user: GithubUser = { id: 7, login: 'grace', name: 'Grace' };
    const { app, db } = await hostedApp(user);

    const orgsBefore = (await listOrgs(db)).length;

    // Two independent browsers, same GitHub account.
    const first = await signIn(app);
    const second = await signIn(app);

    expect(first.cookie).not.toBe(second.cookie);

    const firstSession = await parseJson<{ org: { id: string }; role: string }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: first.cookie } }),
    );
    const secondSession = await parseJson<{ org: { id: string }; role: string }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: second.cookie } }),
    );

    expect(secondSession.org.id).toBe(firstSession.org.id);
    // Exactly one org was created across both sign-ins, not one per device.
    expect((await listOrgs(db)).length).toBe(orgsBefore + 1);

    // And both browsers see the same board.
    await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { Cookie: first.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Shared Board' }),
    });
    const fromSecond = await parseJson<Array<{ name: string }>>(
      await app.request('/api/v1/projects', { headers: { Cookie: second.cookie } }),
    );
    expect(fromSecond.map((p) => p.name)).toEqual(['Shared Board']);
  });

  it('the session cookie is HttpOnly and Secure', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const { setCookie } = await signIn(app);

    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('the raw cookie value is never stored — only its hash', async () => {
    const { app, db } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const { cookie } = await signIn(app);
    const raw = cookie.slice(`${SESSION_COOKIE}=`.length);

    const rows = await db.$client.execute('SELECT token_hash FROM sessions');
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0]?.token_hash)).not.toBe(raw);
  });

  it('logout invalidates server-side — a stolen cookie replayed after logout fails', async () => {
    const { app, db } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const { cookie } = await signIn(app);
    const raw = cookie.slice(`${SESSION_COOKIE}=`.length);

    expect((await app.request('/api/v1/projects', { headers: { Cookie: cookie } })).status).toBe(
      200,
    );

    const logout = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);

    // The row is gone, not merely cleared in the browser.
    expect(await verifySession(db, raw)).toBeUndefined();
    const rows = await db.$client.execute('SELECT id FROM sessions');
    expect(rows.rows).toHaveLength(0);

    // An attacker replaying the captured cookie gets nothing.
    const replay = await app.request('/api/v1/projects', { headers: { Cookie: cookie } });
    expect(replay.status).toBe(401);
  });

  it('logout clears the browser cookie too', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const { cookie } = await signIn(app);

    const logout = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logout.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`);
  });

  it('logout without a session is a no-op, not an error', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const res = await app.request('/api/v1/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('an unknown session cookie is rejected', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const res = await app.request('/api/v1/projects', {
      headers: { Cookie: `${SESSION_COOKIE}=plandesk_sess_forged` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a callback whose state does not match the cookie (CSRF)', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    await app.request('/api/v1/auth/github');

    const res = await app.request('/api/v1/auth/github/callback?code=c&state=attacker-state', {
      headers: { Cookie: 'plandesk_oauth_state=real-state' },
    });
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_state' });
    expect(res.headers.get('set-cookie') ?? '').not.toContain(SESSION_COOKIE);
  });

  it('rejects a callback with no state cookie at all', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const res = await app.request('/api/v1/auth/github/callback?code=c&state=anything');
    expect(res.status).toBe(400);
    expect(await parseJson(res)).toEqual({ error: 'invalid_state' });
  });
});

describe('web session auth — roles hold through the session path', () => {
  async function sessionForRole(role: OrgRole): Promise<{ app: Hono; db: Db; cookie: string }> {
    const user: GithubUser = { id: 55, login: 'vic', name: 'Vic' };
    const { app, db } = await hostedApp(user);

    // Pre-seat the identity in an existing org at `role`, so the callback joins
    // that org instead of minting a fresh owner-org.
    const org = await createOrg(db, { name: 'Team' });
    await addOrgMember(db, { orgId: org.id, userRef: 'github:55', role });

    const { cookie } = await signIn(app);
    return { app, db, cookie };
  }

  it('a viewer with a session still gets 403 on writes', async () => {
    const { app, db, cookie } = await sessionForRole('viewer');

    const session = await parseJson<{ role: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(session.role).toBe('viewer');

    const project = await createProject(db, { name: 'Team Board', orgId: session.org.id });

    // Reads are fine.
    expect(
      (await app.request(`/api/v1/projects/${project.id}`, { headers: { Cookie: cookie } })).status,
    ).toBe(200);

    // Writes are not.
    const write = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Should Fail' }),
    });
    expect(write.status).toBe(403);
    expect(await parseJson(write)).toEqual({ error: 'forbidden' });
  });

  it('an editor with a session can write', async () => {
    const { app, db, cookie } = await sessionForRole('editor');
    const session = await parseJson<{ role: string; org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );
    expect(session.role).toBe('editor');

    const project = await createProject(db, { name: 'Team Board', orgId: session.org.id });
    const write = await app.request(`/api/v1/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Allowed' }),
    });
    expect(write.status).toBe(201);
  });

  it('a session whose membership was revoked stops working', async () => {
    const { app, db, cookie } = await sessionForRole('editor');
    const session = await parseJson<{ org: { id: string } }>(
      await app.request('/api/v1/auth/session', { headers: { Cookie: cookie } }),
    );

    await db.$client.execute({
      sql: 'DELETE FROM org_members WHERE org_id = ? AND user_ref = ?',
      args: [session.org.id, 'github:55'],
    });

    const res = await app.request('/api/v1/projects', { headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
  });
});

describe('web session auth — self-host without a GitHub app (REQ-20)', () => {
  it('githubEnabled:false → /auth/methods reports token', async () => {
    const { app } = await createTestApp({ bindHost: '0.0.0.0' });
    const res = await app.request('/api/v1/auth/methods');
    expect(res.status).toBe(200);
    expect(await parseJson(res)).toEqual({ method: 'token', githubEnabled: false });
  });

  it('githubEnabled:false → /auth/github is 404', async () => {
    const { app } = await createTestApp({ bindHost: '0.0.0.0' });
    expect((await app.request('/api/v1/auth/github')).status).toBe(404);
    expect((await app.request('/api/v1/auth/github/callback?code=c&state=s')).status).toBe(404);
    expect((await app.request('/api/v1/auth/device/start', { method: 'POST' })).status).toBe(404);
  });

  it('a GitHub-less instance still authenticates with a token', async () => {
    const { app, db, orgId } = await createTestApp({ bindHost: '0.0.0.0' });
    const token = await createToken(db, { name: 'self-host', orgId, scope: 'full' });

    // No GitHub app anywhere in sight, and the instance is still fully usable.
    const res = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Self-hosted board' }),
    });
    expect(res.status).toBe(201);
  });

  it('githubEnabled:true → /auth/methods reports device', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const res = await app.request('/api/v1/auth/methods');
    expect(await parseJson(res)).toEqual({ method: 'device', githubEnabled: true });
  });

  it('/auth/methods needs no credential — the sign-in screen reads it first', async () => {
    const { app } = await hostedApp({ id: 1, login: 'ada', name: 'Ada' });
    const res = await app.request('/api/v1/auth/methods');
    expect(res.status).toBe(200);
  });
});

describe('web session auth — local mode is untouched (REQ-21)', () => {
  it('loopback still needs no login and reports owner on the default org', async () => {
    const { app, orgId } = await createTestApp({ bindHost: '127.0.0.1' });

    const res = await app.request('/api/v1/auth/session');
    expect(res.status).toBe(200);
    expect(await parseJson(res)).toEqual({
      kind: 'loopback',
      user_ref: null,
      role: 'owner',
      org: { id: orgId, name: 'Personal' },
    });
  });

  it('a token caller reports kind token', async () => {
    const { app, db, orgId } = await createTestApp({ bindHost: '0.0.0.0' });
    const token = await createToken(db, { name: 't', orgId, scope: 'full' });

    const res = await app.request('/api/v1/auth/session', {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    expect(await parseJson<{ kind: string; user_ref: null }>(res)).toMatchObject({
      kind: 'token',
      user_ref: null,
    });
  });
});

describe('GitHub device auth', () => {
  it('starts, polls, provisions the same org, and discards GitHub credentials', async () => {
    let polls = 0;
    const fetch: FetchLike = (url, init) => {
      if (url.includes('login/device/code')) {
        return Promise.resolve(new Response(JSON.stringify({ device_code: 'device-secret', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 }), { status: 200 }));
      }
      if (url.includes('login/oauth/access_token')) {
        polls++;
        return Promise.resolve(new Response(JSON.stringify(polls === 1 ? { error: 'authorization_pending' } : { access_token: 'gho_device_secret' }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 99, login: 'device-user', name: 'Device User' }), { status: 200 }));
    };
    const { app, db } = await createTestApp({ bindHost: '0.0.0.0', github: { clientId: 'client', clientSecret: 'secret', callbackUrl: 'https://x.test/cb', fetch } });
    const start = await app.request('/api/v1/auth/device/start', { method: 'POST' });
    const started = await parseJson<{ auth_id: string; user_code: string }>(start);
    expect(started.user_code).toBe('ABCD-1234');
    expect(JSON.stringify(started)).not.toContain('device-secret');

    expect(await parseJson(await app.request('/api/v1/auth/device/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_id: started.auth_id }) }))).toEqual({ status: 'pending' });
    const success = await parseJson<{ token: string; org_id: string; login: string }>(await app.request('/api/v1/auth/device/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_id: started.auth_id }) }));
    expect(success.login).toBe('device-user');
    expect(success.token).not.toContain('gho_device_secret');
    expect((await db.$client.execute({ sql: 'SELECT * FROM pending_auth WHERE auth_id = ?', args: [started.auth_id] })).rows).toHaveLength(0);

    const second = await app.request('/api/v1/auth/device/start', { method: 'POST' });
    const secondStart = await parseJson<{ auth_id: string }>(second);
    polls = 1;
    const secondSuccess = await parseJson<{ org_id: string }>(await app.request('/api/v1/auth/device/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_id: secondStart.auth_id }) }));
    expect(secondSuccess.org_id).toBe(success.org_id);
  });

  it.each([
    ['authorization_pending', { status: 'pending' }],
    // RFC 8628 §3.5: slow_down is a signal, not a value — the server must not
    // hand back an interval, because only the client knows what to add 5 to.
    ['slow_down', { status: 'pending', slow_down: true }],
    ['expired_token', { status: 'expired' }],
  ] as const)('maps GitHub %s', async (error, expected) => {
    const fetch: FetchLike = (url) => Promise.resolve(new Response(JSON.stringify(url.includes('device/code') ? { device_code: 'secret', user_code: 'CODE', verification_uri: 'https://github.com/login/device', expires_in: 900 } : { error }), { status: 200 }));
    const { app } = await createTestApp({ bindHost: '0.0.0.0', github: { clientId: 'client', clientSecret: 'secret', callbackUrl: 'https://x.test/cb', fetch } });
    const start = await parseJson<{ auth_id: string }>(await app.request('/api/v1/auth/device/start', { method: 'POST' }));
    const result = await app.request('/api/v1/auth/device/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_id: start.auth_id }) });
    expect(await parseJson(result)).toEqual(expected);
  });
});
