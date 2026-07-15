import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  addOrgMember,
  createOrg,
  createSession,
  deleteSession,
  getOrg,
  listOrgMembershipsForUser,
  type Db,
} from '@plandesk/db';
import { getAuthContext } from '../auth-context.js';
import {
  authorizeUrl,
  GithubOAuthError,
  resolveGithubIdentity,
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
): Promise<{ orgId: string }> {
  const existing = await listOrgMembershipsForUser(db, userRef);
  const first = existing[0];
  if (first !== undefined) {
    return { orgId: first.orgId };
  }

  const org = await createOrg(db, { name: identity.name ?? identity.login });
  await addOrgMember(db, { orgId: org.id, userRef, role: 'owner' });
  return { orgId: org.id };
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
  // `method` is the CLI transport hint, and it reports only what this server
  // can actually serve. Device flow (`/auth/device/*`) is not implemented yet,
  // so a CLI must paste a token even when GitHub sign-in is available in the
  // browser. Flip this to 'device' in the same change that adds the endpoints —
  // advertising a capability the server does not have just moves the failure
  // from a clear message to a 404.
  router.get('/auth/methods', (c) =>
    c.json({
      method: 'token',
      githubEnabled: github !== undefined,
    }),
  );

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
    const org = await getOrg(db, ctx.orgId);
    return c.json({
      kind: ctx.kind,
      user_ref: ctx.kind === 'session' ? ctx.userRef : null,
      role: ctx.permission,
      org: org === undefined ? null : { id: org.id, name: org.name },
    });
  });

  return router;
}
