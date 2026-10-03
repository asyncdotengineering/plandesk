import {
  assertSchemaCurrent,
  getSchemaMigrationSummary,
  isSqliteBusy,
  migrate,
  SchemaDriftError,
  type Db,
  type SchemaMigrationSummary,
} from '@plandesk/db';
import { runBetterAuthMigrations, type BetterAuthInstance } from './better-auth.js';
import {
  backfillDefaultTeams,
  backfillProjectWorkspaces,
  ensureLocalBetterAuthOrganization,
} from './identity.js';

const LEASE_TTL_MS = 60_000;
// Longer than the TTL, so a waiter outlives the lease of a holder that crashed.
const DEFAULT_WAIT_MS = 90_000;
const POLL_MS = 500;

// Outside drizzle's bookkeeping and the migration fixture: only this file
// creates it, so it never reads as schema drift.
const CREATE_LEASE_TABLE =
  'CREATE TABLE IF NOT EXISTS __plandesk_lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL)';

export type PrepareDatabaseOptions = {
  /** Lease holder id; a random one per call by default. */
  holder?: string;
  /** How long to wait for another holder before giving up (default 90 s). */
  waitMs?: number;
  /** Local single-org board: also ensures the local organization. */
  local?: boolean;
};

/** Gave up waiting while another instance still held the lease. */
export class SchemaLeaseHeldError extends SchemaDriftError {
  constructor(
    summary: SchemaMigrationSummary,
    public readonly holder: string,
    public readonly expiresAt: number,
  ) {
    super(summary);
    this.name = 'SchemaLeaseHeldError';
    this.message =
      `Database is being prepared by another instance (${holder}, lease expires ` +
      `${new Date(expiresAt).toISOString()}); gave up waiting with ` +
      `${String(summary.applied)}/${String(summary.shipped)} migrations applied.`;
  }
}

/** One compare-and-set: succeeds only when no lease exists or it has expired. */
async function acquireLease(db: Db, holder: string): Promise<boolean> {
  try {
    await db.$client.execute(CREATE_LEASE_TABLE);
    const now = Date.now();
    const result = await db.$client.execute({
      sql:
        'INSERT INTO __plandesk_lease (id, holder, expires_at) VALUES (1, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at ' +
        'WHERE __plandesk_lease.expires_at < ?',
      args: [holder, now + LEASE_TTL_MS, now],
    });
    return result.rowsAffected === 1;
  } catch (error) {
    // A local file peer is mid-migration and holds the write lock.
    if (isSqliteBusy(error)) return false;
    throw error;
  }
}

/**
 * better-auth keeps no ledger, so "behind" means its own diff finds tables or
 * columns to create. `getMigrations` is read-only: two sqlite_master /
 * pragma_table_info selects.
 */
async function betterAuthBehind(auth: BetterAuthInstance): Promise<boolean> {
  const { getMigrations } = await import('better-auth/db/migration');
  const { toBeCreated, toBeAdded } = await getMigrations(auth.options);
  return toBeCreated.length > 0 || toBeAdded.length > 0;
}

/**
 * Backfills keep no ledger either, so look for exactly what they repair: an
 * organization with no team (backfillDefaultTeams), a project whose
 * workspace_id is not a team of its own org (backfillProjectWorkspaces).
 * Default-team membership is not checked: invitations and project creation
 * keep it in step at runtime through ensureDefaultTeamForOrg.
 */
async function backfillNeeded(db: Db): Promise<boolean> {
  const result = await db.$client.execute(
    'SELECT EXISTS (SELECT 1 FROM organization o WHERE NOT EXISTS ' +
      '(SELECT 1 FROM team t WHERE t.organizationId = o.id)) ' +
      'OR EXISTS (SELECT 1 FROM projects p WHERE NOT EXISTS ' +
      '(SELECT 1 FROM team t WHERE t.id = p.workspace_id AND t.organizationId = p.org_id)) AS needed',
  );
  return Number(result.rows[0]?.needed) === 1;
}

async function isPrepared(db: Db, auth: BetterAuthInstance): Promise<boolean> {
  return (
    (await getSchemaMigrationSummary(db)).current &&
    !(await betterAuthBehind(auth)) &&
    !(await backfillNeeded(db))
  );
}

async function readLease(db: Db): Promise<{ holder: string; expiresAt: number } | undefined> {
  try {
    const row = (
      await db.$client.execute('SELECT holder, expires_at FROM __plandesk_lease WHERE id = 1')
    ).rows[0];
    return row === undefined
      ? undefined
      : { holder: row.holder as string, expiresAt: Number(row.expires_at) };
  } catch {
    return undefined; // no lease table yet
  }
}

/**
 * The one way any entry readies its database: domain migrations, better-auth
 * tables and the workspace backfills, run by whichever instance holds the
 * `__plandesk_lease` row. A prepared database costs reads only, no write.
 * The holder renews its lease every TTL/3 while it works. Throws
 * `SchemaLeaseHeldError` (a `SchemaDriftError`) when another holder keeps the
 * lease past `waitMs`.
 */
export async function prepareDatabase(
  db: Db,
  auth: BetterAuthInstance,
  opts: PrepareDatabaseOptions = {},
): Promise<{ applied: string[] }> {
  // A local board keeps its every-boot org check and backfills.
  if (opts.local !== true && (await isPrepared(db, auth))) {
    return { applied: [] };
  }
  const holder = opts.holder ?? globalThis.crypto.randomUUID();
  const deadline = Date.now() + (opts.waitMs ?? DEFAULT_WAIT_MS);
  for (;;) {
    if (await acquireLease(db, holder)) {
      // A failed renewal is dropped; the next tick retries before the TTL runs out.
      const renew = setInterval(() => {
        void db.$client
          .execute({
            sql: 'UPDATE __plandesk_lease SET expires_at = ? WHERE id = 1 AND holder = ?',
            args: [Date.now() + LEASE_TTL_MS, holder],
          })
          .catch(() => undefined);
      }, LEASE_TTL_MS / 3);
      let applied: string[];
      try {
        ({ applied } = await migrate(db));
        await runBetterAuthMigrations(auth);
        if (opts.local === true) await ensureLocalBetterAuthOrganization(db, auth);
        await backfillDefaultTeams(auth);
        await backfillProjectWorkspaces(db, auth);
      } finally {
        clearInterval(renew);
        await db.$client.execute({
          sql: 'DELETE FROM __plandesk_lease WHERE id = 1 AND holder = ?',
          args: [holder],
        });
      }
      await assertSchemaCurrent(db);
      return { applied };
    }
    if (await isPrepared(db, auth)) {
      return { applied: [] };
    }
    if (Date.now() >= deadline) {
      const summary = await getSchemaMigrationSummary(db);
      const lease = await readLease(db);
      throw lease === undefined
        ? new SchemaDriftError(summary)
        : new SchemaLeaseHeldError(summary, lease.holder, lease.expiresAt);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
