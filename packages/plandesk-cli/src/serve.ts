import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import {
  createApp,
  createBetterAuth,
  createServices,
  createS3Adapter,
  ensureLocalBetterAuthOrganization,
  mountStatic,
  runBetterAuthMigrations,
} from '@plandesk/api';
import { createDb, migrate } from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { resolveAuthPassword, resolveBindHost, resolveDataDir, workspaceDbPath } from './args.js';
import { resolveServerConfig } from './config.js';
import {
  deleteServerInfo,
  readWorkspaceJson,
  writeServerInfo,
} from './connect-artifacts.js';
import { ensureLocalBetterAuthSecret } from './init.js';

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
  const authPassword = options.authPassword ?? resolveAuthPassword();
  return { host, authPassword };
}

export function createListenErrorHandler(
  port: number,
  exit: ExitFn = defaultExit,
): (err: NodeJS.ErrnoException) => void {
  return (err) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `Error: port ${String(port)} is already in use — the Plan Desk board is already served there (one board per machine). Stop the other process, or pass --port <n> for a different bind.\n`,
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

  // Database: a remote libSQL URL (self-host/cloud) is opened as-is and NOT
  // migrated at boot — the operator owns those migrations (REQ-8). No URL →
  // local file SQLite, migrated and bootstrapped at boot (the local topology).
  const dbUrl = cfg.values.dbUrl;
  const dbPath = workspaceDbPath(dataDir);
  const dbDisplay = dbUrl ?? dbPath;
  const db =
    dbUrl !== undefined ? await createDb(dbUrl, cfg.values.dbToken) : await createDb(dbPath);
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const betterAuthBaseURL = cfg.values.baseUrl ?? `http://${urlHost}:${String(options.port)}`;
  let betterAuthSecret = cfg.values.sessionSecret;
  if (dbUrl === undefined) {
    betterAuthSecret ??= ensureLocalBetterAuthSecret(dataDir);
    await migrate(db);
    const auth = createBetterAuth({
      client: db.$client,
      secret: betterAuthSecret,
      baseURL: betterAuthBaseURL,
      github: cfg.values.github,
    });
    if (auth === undefined) throw new Error('Local better-auth secret was not created');
    await runBetterAuthMigrations(auth);
    await ensureLocalBetterAuthOrganization(db, auth);
  }

  const storage =
    cfg.values.storage.kind === 's3'
      ? createS3Adapter({ db, config: cfg.values.storage })
      : undefined;
  const services = createServices({ db, ...(storage !== undefined ? { storage } : {}) });
  // BA7-1a: parent createApp resolves better-auth apiKey / session / loopback;
  // MCP prefers that context (legacy token store unused).
  const mcpApp = createMcpApp({
    services,
    tokenStore: {
      async verify() {
        return undefined;
      },
    },
  });
  const app = createApp({
    db,
    services,
    mcp: mcpApp,
    authPassword,
    bindHost: host,
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
    });
    process.stdout.write(`Plan Desk → http://${host}:${String(boundPort)}  (db: ${dbDisplay})\n`);
  };

  server.once('close', () => {
    deleteServerInfo(dataDir);
  });

  // One global board → one fixed port. Always fail clearly if the port is busy
  // (the other listener is almost always this same board already running).
  server.on('error', createListenErrorHandler(options.port, exit));
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
