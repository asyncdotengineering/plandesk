/**
 * better-auth foundation (migration slice 1/6).
 *
 * Nothing in this app consumes this yet — `createApp` mounts the handler
 * (see server.ts) but every existing route keeps going through
 * `createOrgAuthMiddleware` exactly as before. This file only proves the
 * config boots on our driver.
 *
 * Dialect choice (REQ-3): a Kysely `LibsqlDialect`, not `drizzleAdapter`.
 * `@better-auth/cli` (which would normally generate a Drizzle schema for
 * the adapter) is pinned two minors behind this `better-auth` release, so
 * its output can't be trusted to match — hand-rolling a Drizzle schema for
 * the tables we don't own the shape of is the same trust problem by hand.
 * The Kysely dialect needs no generated schema: better-auth introspects and
 * creates its own tables at runtime (see `runBetterAuthMigrations` below).
 * This is exactly what `scratchpad/ba-spike/spike.mjs` proved 9/9 on.
 *
 * Migration seam (REQ-4): better-auth's tables are created by
 * `better-auth/db/migration`'s runtime migrator, which diffs the live
 * schema via Kysely's introspector and emits `CREATE TABLE` for whatever
 * is missing — it keeps no ledger table of its own. Our 16 Drizzle
 * migrations keep bookkeeping in `__drizzle_migrations`. Two independent,
 * non-overlapping table sets, two independent, non-overlapping bookkeeping
 * mechanisms: neither can fight over the other's tables or history.
 *
 * The dialect wraps the SAME libSQL `Client` the caller's `Db` already
 * holds (`db.$client`), rather than opening a second connection from a
 * URL. A fresh `:memory:` URL would open a second, empty, unrelated
 * database — see the connection-per-transaction footgun documented next to
 * `withTransaction` in `@plandesk/db`'s client.ts — so sharing the
 * connection is required for correctness, not just efficiency.
 */
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import type { Client, Db } from '@plandesk/db';
import { ac, admin, member, owner } from './access-control.js';
import {
  provisionPersonalOrgIfNeeded,
  setDefaultActiveOrganization,
  setDefaultActiveTeam,
} from './identity.js';

export type BetterAuthDeps = {
  /** The app's existing libSQL connection — shared, never a second one. */
  client: Client;
  /**
   * App Db for personal-org provisioning on first GitHub session (BA4c).
   * When omitted, databaseHooks are not installed (foundation tests only).
   */
  db?: Db;
  /** Absent secret -> feature is off, still boots (mirrors `github: undefined`). */
  secret: string | undefined;
  baseURL: string;
  github?: { clientId: string; clientSecret: string };
};

/**
 * Erase the exact plugin tuple from the public type so TypeScript can emit a
 * stable declaration while retaining the handler, adapter context, and API.
 * Plugin endpoints (verifyApiKey / createApiKey) are reached via runtime-
 * validated accessors in agent-keys.ts (BA5).
 */
export type BetterAuthInstance = Auth;

/** Absent secret -> undefined, the supported no-auth-mounted state (REQ-5). */
export function createBetterAuth(deps: BetterAuthDeps): BetterAuthInstance | undefined {
  if (deps.secret === undefined || deps.secret.length === 0) {
    return undefined;
  }

  // Closed over after construction so session.create.after can use the instance.
  let authInstance: BetterAuthInstance | undefined;
  const appDb = deps.db;

  const options: BetterAuthOptions = {
    database: { dialect: new LibsqlDialect({ client: deps.client }), type: 'sqlite' },
    secret: deps.secret,
    baseURL: deps.baseURL,
    emailAndPassword: { enabled: true, disableSignUp: true },
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: true,
        trustedProviders: ['github'],
      },
    },
    ...(deps.github === undefined
      ? {}
      : {
          socialProviders: {
            github: { clientId: deps.github.clientId, clientSecret: deps.github.clientSecret },
          },
        }),
    // BA4c: session.create fires after OAuth has linked the github account
    // (user+account already exist). Invited members already hold a member row
    // so provision is a no-op. Public adapter.create (test seeds) does not fire
    // these hooks — only internalAdapter / real OAuth paths do.
    ...(appDb === undefined
      ? {}
      : {
          databaseHooks: {
            session: {
              create: {
                after: async (session) => {
                  if (authInstance === undefined) return;
                  await provisionPersonalOrgIfNeeded(authInstance, appDb, session.userId);
                  const activeOrgId = await setDefaultActiveOrganization(
                    authInstance,
                    session.userId,
                    session.token,
                  );
                  await setDefaultActiveTeam(
                    authInstance,
                    session.userId,
                    session.token,
                    activeOrgId,
                  );
                },
              },
            },
          },
        }),
    plugins: [
      organization({ ac, roles: { owner, admin, member }, teams: { enabled: true } }),
      // enableMetadata: projectId + orgId on agent keys (BA5). Rate limit off —
      // agent traffic is bursty; ceilings are permission-based, not request-count.
      apiKey({ enableMetadata: true, rateLimit: { enabled: false } }),
    ],
  };
  authInstance = betterAuth(options);
  return authInstance;
}

/**
 * Create better-auth's tables against the shared connection. Node CLI boot
 * and operator migration paths call this explicitly; edge request handlers do
 * not migrate.
 */
export async function runBetterAuthMigrations(auth: BetterAuthInstance): Promise<void> {
  const { getMigrations } = await import('better-auth/db/migration');
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
