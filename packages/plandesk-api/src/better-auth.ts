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
 * 9 tables we don't own the shape of is the same trust problem by hand.
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
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { organization, deviceAuthorization } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import type { Client } from '@plandesk/db';

export type BetterAuthDeps = {
  /** The app's existing libSQL connection — shared, never a second one. */
  client: Client;
  /** Absent secret -> feature is off, still boots (mirrors `github: undefined`). */
  secret: string | undefined;
  baseURL: string;
};

/**
 * `betterAuth(...)`'s real return type is `Auth<Options>`, generic over the
 * exact plugin/config literal passed in — TS can't print that structurally
 * (it bottoms out in an unnameable internal zod type) in a declaration file.
 * This is the narrow slice this app actually calls: the request handler
 * (mounted in server.ts) and the options object (fed to the runtime
 * migrator below). A real `Auth<Options>` value satisfies both fields.
 */
export type BetterAuthInstance = {
  handler: (request: Request) => Promise<Response>;
  options: BetterAuthOptions;
};

/** Absent secret -> undefined, the supported no-auth-mounted state (REQ-5). */
export function createBetterAuth(deps: BetterAuthDeps): BetterAuthInstance | undefined {
  if (deps.secret === undefined || deps.secret.length === 0) {
    return undefined;
  }
  return betterAuth({
    database: { dialect: new LibsqlDialect({ client: deps.client }), type: 'sqlite' },
    secret: deps.secret,
    baseURL: deps.baseURL,
    plugins: [organization(), apiKey(), deviceAuthorization()],
  });
}

/**
 * Create better-auth's 9 tables against the shared connection. Never called
 * from request-serving code in this slice — only tests and, later, an
 * explicit ops step call this, the same way `@plandesk/db`'s `migrate` is
 * opt-in rather than run on every request.
 */
export async function runBetterAuthMigrations(auth: BetterAuthInstance): Promise<void> {
  const { getMigrations } = await import('better-auth/db/migration');
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
