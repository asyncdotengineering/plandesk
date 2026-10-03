/**
 * Node entry (`plandesk serve`, which Docker runs): the shared composition
 * with the libsql Node client, the SPA served from disk and, on a loopback
 * bind, disk access for check_references. Only Node imports this module, so
 * the Worker bundle never pulls `node:fs`.
 */
import { existsSync } from 'node:fs';
import type { Hono } from 'hono';
import { createDb, SchemaDriftError, type Db, type ReferenceCheckFs } from '@plandesk/db';
import { isLoopbackBind, mountStatic, type ServerEnv } from '@plandesk/api';
import { composeApp } from './hosted-app.js';

export type NodeAppOptions = {
  /** Resolved server config, with `dbUrl` and `authSecret` already settled by the caller. */
  config: ServerEnv;
  /** A local single-org board on a file the caller owns, rather than a shared database. */
  local: boolean;
  /** Bind host: loopback trust and check_references disk access follow it. */
  host: string;
  /** Advertised origin; better-auth's baseURL when PLANDESK_BASE_URL is unset. */
  origin: string;
  /** Board directory, surfaced on /api/v1/health. */
  dataDir: string;
  /** Runs after each successful prepare (the CLI's repo folder backfill). */
  afterPrepare?: (db: Db) => Promise<unknown>;
};

/**
 * Disk access for check_references, granted only on a loopback bind.
 *
 * Any org member can point a project's folder_path at an arbitrary absolute
 * path, so on a server others can reach a disk probe would tell them whether
 * any file on the host exists. Loopback means the caller is the machine's
 * owner — the same rule attach_file follows. Elsewhere the check reports
 * unknown.
 */
export function referenceCheckFsFor(bindHost: string): ReferenceCheckFs | undefined {
  return isLoopbackBind(bindHost)
    ? { pathExists: existsSync, folderExists: existsSync }
    : undefined;
}

/** Builds the Node app and runs its first prepare; throws on a config it cannot run with. */
export async function createNodeApp(opts: NodeAppOptions): Promise<Hono> {
  const { app, prepare } = await composeApp(opts.config, {
    openDb: createDb,
    local: opts.local,
    bindHost: opts.host,
    requestOrigin: opts.origin,
    dataDir: opts.dataDir,
    referenceCheckFs: referenceCheckFsFor(opts.host),
    mountStatic,
    afterPrepare: opts.afterPrepare,
  });
  // Prepare at boot, so a healthy board is current before it listens. Not in
  // composeApp: under workerd, awaiting it inside the memoised build hangs
  // later better-auth requests. A schema left behind by another instance is the
  // gate's to report (503 and retry); anything else fails the boot loudly.
  await prepare().catch((err: unknown) => {
    if (!(err instanceof SchemaDriftError)) throw err;
  });
  return app;
}
