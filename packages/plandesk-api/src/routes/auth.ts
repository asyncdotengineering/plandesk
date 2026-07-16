import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  addOrgMember,
  createPendingAuth,
  createToken,
  createOrg,
  createSession,
  deleteSession,
  getOrg,
  listOrgMembershipsForUser,
  deleteExpiredPendingAuth,
  deletePendingAuth,
  getPendingAuth,
  type Db,
} from '@plandesk/db';
import { getAuthContext } from '../auth-context.js';
import {
  authorizeUrl,
  GithubOAuthError,
  pollDeviceFlow,
  resolveGithubIdentity,
  startDeviceFlow,
  userRefFromGithubId,
  type GithubConfig,
  type GithubIdentity,
} from '../github.js';
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  readOAuthStateCookie,
  readSessionCookie,
  setOAuthStateCookie,
  setSessionCookie,
} from '../session.js';

export type AuthRouterDeps = {
  db: Db;
  /** Absent on a self-hosted instance with no GitHub app registered (REQ-20). */
  github?: GithubConfig;
};

/** Constant-time compare so state checking cannot be probed byte by byte. */
function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * The org this identity already belongs to, or a fresh one on first sign-in.
 *
 * Keyed on the stable `github:<numeric id>` user_ref, so the same person
 * signing in from a second browser lands back in the same org rather than
 * accumulating one org per device.
 */
async function findOrCreateOrgForIdentity(
  db: Db,
  userRef: string,
  identity: GithubIdentity,
): Promise<{ orgId: string; orgName: string }> {
  const existing = await listOrgMembershipsForUser(db, userRef);
  const first = existing[0];
  if (first !== undefined) {
    const org = await getOrg(db, first.orgId);
    if (org === undefined) throw new Error('Org membership points to a missing org');
    return { orgId: org.id, orgName: org.name };
  }

  const org = await createOrg(db, { name: identity.name ?? identity.login });
  await addOrgMember(db, { orgId: org.id, userRef, role: 'owner' });
  return { orgId: org.id, orgName: org.name };
}

export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const router = new Hono();
  const { db, github } = deps;

  // What sign-in this instance offers.
  //
  // `githubEnabled` is for the dashboard: it decides between "Sign in with
  // GitHub" and token entry. A self-hoster who never registered a GitHub app
  // gets the token path (REQ-20).
  //
  router.get('/auth/methods', (c) =>
    c.json({
      method: github === undefined ? 'token' : 'device',
      githubEnabled: github !== undefined,
    }),
  );

  router.post('/auth/device/start', async (c) => {
    if (github === undefined) return c.json({ error: 'not_found' }, 404);
    // Sweep here, on the only call that adds rows: an abandoned login is never
    // polled again, so the poll path's expiry check would never reach it.
    await deleteExpiredPendingAuth(db);
    const flow = await startDeviceFlow(github);
    const authId = randomUUID();
    await createPendingAuth(db, {
      authId,
      deviceCode: flow.deviceCode,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    return c.json({
      auth_id: authId,
      user_code: flow.userCode,
      verification_uri: flow.verificationUri,
      interval: flow.interval,
      expires_in: flow.expiresIn,
    });
  });

  router.post('/auth/device/poll', async (c) => {
    if (github === undefined) return c.json({ error: 'not_found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { auth_id?: unknown };
    if (typeof body.auth_id !== 'string' || body.auth_id === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const pending = await getPendingAuth(db, body.auth_id);
    if (pending === undefined || pending.expiresAt.getTime() <= Date.now()) {
      if (pending !== undefined) await deletePendingAuth(db, body.auth_id);
      return c.json({ error: 'not_found' }, 404);
    }
    const result = await pollDeviceFlow(github, pending.deviceCode);
    if (result.status === 'pending') {
      return c.json(result.slowDown === true ? { status: 'pending', slow_down: true } : { status: 'pending' });
    }
    if (result.status === 'expired') {
      await deletePendingAuth(db, body.auth_id);
      return c.json(result);
    }
    const userRef = userRefFromGithubId(result.identity.id);
    const { orgId, orgName } = await findOrCreateOrgForIdentity(db, userRef, result.identity);
    const token = await createToken(db, { name: 'CLI login', orgId, scope: 'full' });
    await deletePendingAuth(db, body.auth_id);
    return c.json({ token: token.token, org_id: orgId, org_name: orgName, login: result.identity.login });
  });

  router.get('/auth/github', (c) => {
    if (github === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }
    // CSRF: the state we send to GitHub must come back to us, and only this
    // browser holds the copy it is compared against.
    const state = randomBytes(32).toString('base64url');
    setOAuthStateCookie(c, state);
    return c.redirect(authorizeUrl(github, state), 302);
  });

  router.get('/auth/github/callback', async (c) => {
    if (github === undefined) {
      return c.json({ error: 'not_found' }, 404);
    }

    const code = c.req.query('code');
    const state = c.req.query('state');
    const expectedState = readOAuthStateCookie(c);
    clearOAuthStateCookie(c);

    if (typeof code !== 'string' || code === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    if (
      typeof state !== 'string' ||
      state === '' ||
      expectedState === undefined ||
      !statesMatch(state, expectedState)
    ) {
      return c.json({ error: 'invalid_state' }, 400);
    }

    let identity: GithubIdentity;
    try {
      identity = await resolveGithubIdentity(github, code);
    } catch (err) {
      if (err instanceof GithubOAuthError) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      throw err;
    }

    // Identity is the numeric id: a GitHub rename must not orphan the org.
    const userRef = userRefFromGithubId(identity.id);
    const { orgId } = await findOrCreateOrgForIdentity(db, userRef, identity);
    const session = await createSession(db, { orgId, userRef });

    setSessionCookie(c, session.token, session.expiresAt);
    return c.redirect(github.dashboardUrl ?? '/', 302);
  });

  router.post('/auth/logout', async (c) => {
    const token = readSessionCookie(c);
    if (token !== undefined) {
      // Server-side revocation: clearing the browser's copy alone would leave
      // an exfiltrated cookie working until it expired.
      await deleteSession(db, token);
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // Who the caller is right now, for the org/role badge and the sign-out
  // control. Unauthenticated callers never reach this — org auth answers 401
  // first, which is the dashboard's cue to show sign-in.
  router.get('/auth/session', async (c) => {
    const ctx = getAuthContext();
    if (ctx.kind === 'guest') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const org = await getOrg(db, ctx.orgId);
    return c.json({
      kind: ctx.kind,
      user_ref: ctx.kind === 'session' ? ctx.userRef : null,
      role: ctx.role,
      org: org === undefined ? null : { id: org.id, name: org.name },
    });
  });

  return router;
}
