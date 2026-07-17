import { Hono } from 'hono';
import type { Db } from '@plandesk/db';
import { createOrgOwnerKey } from '../agent-keys.js';
import { getAuthContext } from '../auth-context.js';
import type { BetterAuthInstance } from '../better-auth.js';
import type { GithubConfig } from '../github.js';
import { listOrganizationsForUser, resolveOrganizationName } from '../organizations.js';
import { requirePermission } from '../permissions.js';

export type AuthRouterDeps = {
  db: Db;
  /** Absent on a self-hosted instance with no GitHub app registered (REQ-20). */
  github?: GithubConfig;
  /** better-auth instance for session-gated CLI owner-key mint (BA4b-2). */
  betterAuth?: BetterAuthInstance;
};

export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const router = new Hono();
  const { github, betterAuth } = deps;

  // What sign-in this instance offers.
  //
  // `githubEnabled` is for the dashboard: it decides between "Sign in with
  // GitHub" and token entry. A self-hoster who never registered a GitHub app
  // gets the token path (REQ-20). Device flow is gone — paste-a-token only.
  router.get('/auth/methods', (c) =>
    c.json({
      method: 'token' as const,
      githubEnabled: github !== undefined,
    }),
  );

  // Who the caller is right now, for the org/role badge and the sign-out
  // control. Unauthenticated callers never reach this — org auth answers 401
  // first, which is the dashboard's cue to show sign-in.
  router.get('/auth/session', async (c) => {
    const ctx = getAuthContext();
    if (ctx.kind === 'guest') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const org = await resolveOrganizationName(betterAuth, ctx.orgId);
    let orgs: Array<{ id: string; name: string; role: string }> = [
      { id: org.id, name: org.name, role: ctx.role ?? 'member' },
    ];
    if (ctx.kind === 'session' && betterAuth !== undefined) {
      const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
      if (session === null) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      orgs = await listOrganizationsForUser(betterAuth, session.user.id);
    }
    return c.json({
      kind: ctx.kind,
      user_ref: ctx.kind === 'session' ? ctx.userRef : null,
      role: ctx.role,
      org,
      orgs,
    });
  });

  /**
   * BA4b-2: mint an org-wide owner API key for CLI paste (`plandesk login`).
   * Session-only — apikey/token/loopback must not mint owner keys here.
   * Raw key returned once; never stored retrievable.
   */
  router.post('/auth/cli-token', async (c) => {
    if (betterAuth === undefined) {
      return c.json({ error: 'unavailable' }, 503);
    }

    const ctx = getAuthContext();
    if (ctx.kind !== 'session') {
      return c.json({ error: 'unauthorized' }, 401);
    }
    requirePermission(ctx, 'apiKey', 'create');

    const baSession = await betterAuth.api.getSession({ headers: c.req.raw.headers });
    if (baSession === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let name = 'CLI token';
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name === 'string' && body.name.trim() !== '') {
      name = body.name.trim();
    }

    const minted = await createOrgOwnerKey({
      auth: betterAuth,
      userId: baSession.user.id,
      orgId: ctx.orgId,
      name,
    });

    const org = await resolveOrganizationName(betterAuth, ctx.orgId);
    return c.json({
      token: minted.key,
      org_id: ctx.orgId,
      org_name: org.name,
    });
  });

  return router;
}
