import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import {
  isLoopbackBind,
  createApp,
  createBetterAuth,
  createServices,
  createStorageAdapter,
  mountStatic,
  prepareDatabase,
  readServerEnv,
} from '@plandesk/api';
import { createDb, type ReferenceCheckFs } from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { resolveBindHost, resolveDataDir, workspaceDbPath } from './args.js';
import { resolveServerConfig } from './config.js';
import {
  deleteServerInfo,
  fetchServedDataDir,
  readWorkspaceJson,
  writeServerInfo,
} from './connect-artifacts.js';
import { ensureLocalBetterAuthSecret } from './init.js';
import { backfillRepoFolderPathFromCwd } from './folder-path-backfill.js';

export type ServeOptions = {
  port: number;
  dataDir?: string;
  host?: string;
  authPassword?: string;
  strictPort?: boolean;
  /** Explicit `--config <path>` for plandesk.server.json. */
  configPath?: string;
};

export type ExitFn = (code: number) => never;

const defaultExit: ExitFn = (code) => {
  process.exit(code);
};

export function validateServeBind(options: ServeOptions): {
  host: string;
  authPassword?: string;
} {
  const host = resolveBindHost(options.host);
  const authPassword = options.authPassword ?? readServerEnv(process.env).authPassword;
  return { host, authPassword };
}

/**
 * REQ-A3c: on EADDRINUSE, ask whoever already owns the port which board they
 * serve — the collision is often a different repo's shadow board landing on
 * the same default port, not this same board's own second instance.
 */
export function createListenErrorHandler(
  port: number,
  exit: ExitFn = defaultExit,
): (err: NodeJS.ErrnoException) => Promise<void> {
  return async (err) => {
    if (err.code === 'EADDRINUSE') {
      const ownerDataDir = await fetchServedDataDir(`http://127.0.0.1:${String(port)}`);
      const ownerInfo = ownerDataDir !== undefined ? ` (board: ${ownerDataDir})` : '';
      process.stderr.write(
        `Error: port ${String(port)} is already in use${ownerInfo} — the Plan Desk board is already served there (one board per machine). Stop the other process, or pass --port <n> for a different bind.\n`,
      );
      exit(1);
      return;
    }
    throw err;
  };
}

export type ServeRuntime = {
  port: number;
  host: string;
  dataDir?: string;
  configPath?: string;
  strictPort: boolean;
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

export function resolveServeOrigin(host: string, port: number): string {
  const advertisedHost = host.trim().toLowerCase() === 'localhost' ? '127.0.0.1' : host;
  const urlHost =
    advertisedHost.includes(':') && !advertisedHost.startsWith('[')
      ? `[${advertisedHost}]`
      : advertisedHost;
  return `http://${urlHost}:${String(port)}`;
}

/**
 * Resolve serve host/port/dataDir from flags > workspace.json > config file >
 * default. Extracted so the precedence (and "boots from a config file alone",
 * REQ-1/REQ-2) is unit-testable without binding a socket.
 */
export function resolveServeRuntime(parsed: {
  port?: number;
  dataDir?: string;
  host?: string;
  strictPort: boolean;
  configPath?: string;
}): ServeRuntime {
  const dataDir = resolveDataDir(parsed.dataDir);
  const cfg = resolveServerConfig({ configPath: parsed.configPath, dataDir });
  const workspacePort = readWorkspaceJson(dataDir)?.port;
  const port = parsed.port ?? workspacePort ?? cfg.values.port;
  const host = parsed.host ?? cfg.values.host;
  return {
    port,
    host,
    dataDir: parsed.dataDir,
    configPath: parsed.configPath,
    strictPort: parsed.strictPort,
  };
}

export async function startServer(
  options: ServeOptions,
  exit: ExitFn = defaultExit,
): Promise<Server> {
  const { host } = validateServeBind(options);
  const dataDir = resolveDataDir(options.dataDir);

  // Server config: env > file > default (see config.ts). Flags layer above this
  // at the cli boundary; here we read env/file for db, storage, github, and the
  // file-only fallback for authPassword.
  const cfg = resolveServerConfig({ configPath: options.configPath, dataDir });
  // flag (options.authPassword) > env > file — resolveServerConfig already
  // folded env > file, so this is the full precedence.
  const authPassword = options.authPassword ?? cfg.values.authPassword;

  // Database: a remote libSQL URL (self-host/cloud) or, with no URL, the local
  // file. Either way the server prepares it under the lease (prepareDatabase).
  const dbUrl = cfg.values.dbUrl;
  const local = dbUrl === undefined;
  const dbPath = workspaceDbPath(dataDir);
  const dbDisplay = dbUrl ?? dbPath;
  const db = local ? await createDb(dbPath) : await createDb(dbUrl, cfg.values.dbToken);
  const betterAuthBaseURL = cfg.values.baseUrl ?? resolveServeOrigin(host, options.port);
  const betterAuthSecret =
    cfg.values.authSecret ?? (local ? ensureLocalBetterAuthSecret(dataDir) : undefined);
  // A remote board without a secret serves no better-auth, but its tables are
  // still prepared, so a throwaway secret drives the migrator.
  const auth = createBetterAuth({
    client: db.$client,
    secret: betterAuthSecret ?? randomBytes(32).toString('base64url'),
    baseURL: betterAuthBaseURL,
    github: cfg.values.github,
  });
  if (auth === undefined) throw new Error('Better-auth migrator secret was not created');
  await prepareDatabase(db, auth, { local });

  const storage = createStorageAdapter({ db, storage: cfg.values.storage });
  const referenceCheckFs = referenceCheckFsFor(host);
  const services = createServices({
    db,
    auth: local ? auth : undefined,
    storage,
    ...(referenceCheckFs !== undefined ? { referenceCheckFs } : {}),
  });
  await backfillRepoFolderPathFromCwd(db);
  // Parent createApp resolves better-auth apiKey / session / loopback;
  // MCP requires that context (no independent auth path).
  const mcpApp = createMcpApp({ services, bindHost: host });
  const app = createApp({
    db,
    services,
    mcp: mcpApp,
    authPassword,
    bindHost: host,
    dataDir,
    // GitHub sign-in comes from the resolved config (env > file). With no
    // client id/secret configured, the server simply has no GitHub sign-in
    // (REQ-20) — the supported self-host path, not a degraded one.
    github: cfg.values.github,
    ...(betterAuthSecret === undefined
      ? {}
      : { betterAuth: { secret: betterAuthSecret, baseURL: betterAuthBaseURL } }),
  });
  // Node-only: serve the bundled web SPA from disk. Edge entries use platform assets.
  mountStatic(app);

  const server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  const logListening = (): void => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
    writeServerInfo(dataDir, {
      port: boundPort,
      pid: process.pid,
      host,
      startedAt: new Date().toISOString(),
      dataDir,
    });
    process.stdout.write(
      `Plan Desk → ${resolveServeOrigin(host, boundPort)}  (db: ${dbDisplay})\n`,
    );
  };

  server.once('close', () => {
    deleteServerInfo(dataDir);
  });

  // One global board → one fixed port. Always fail clearly if the port is busy
  // (the other listener is almost always this same board already running).
  const handleListenError = createListenErrorHandler(options.port, exit);
  server.on('error', (error) => {
    void handleListenError(error).catch((handlerError: unknown) => {
      process.nextTick(() => {
        throw handlerError;
      });
    });
  });
  server.listen(options.port, host, logListening);

  return server;
}

export async function runServe(options: ServeOptions): Promise<Server> {
  const server = await startServer(options);
  const dataDir = resolveDataDir(options.dataDir);

  const shutdown = () => {
    deleteServerInfo(dataDir);
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}
