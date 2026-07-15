import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createApp, createServices, createS3Adapter, mountStatic } from '@plandesk/api';
import { createDb, ensureDefaultOrg, migrate, verifyToken } from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { resolveAuthPassword, resolveBindHost, resolveDataDir, workspaceDbPath } from './args.js';
import { resolveServerConfig } from './config.js';
import {
  deleteServerInfo,
  isPortOwnedByAnotherProject,
  readPortRegistry,
  readWorkspaceJson,
  reservePort,
  writeServerInfo,
} from './connect-artifacts.js';
import { PORT_RANGE_START, PORT_RANGE_END } from './init.js';

export type ServeOptions = {
  port: number;
  dataDir?: string;
  host?: string;
  authPassword?: string;
  strictPort?: boolean;
  /** Explicit `--config <path>` for plandesk.server.json. */
  configPath?: string;
};

/** How many sequential ports to try before giving up (Vite/Expo-style rotation). */
export const PORT_ROTATE_ATTEMPTS = 20;

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
      process.stderr.write(`Error: port ${String(port)} is already in use\n`);
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
export function resolveServeRuntime(
  parsed: {
    port?: number;
    dataDir?: string;
    host?: string;
    strictPort: boolean;
    configPath?: string;
  },
): ServeRuntime {
  const dataDir = resolveDataDir(parsed.dataDir);
  const cfg = resolveServerConfig({ configPath: parsed.configPath, dataDir });
  const workspacePort = readWorkspaceJson(dataDir)?.port;
  const port = parsed.port ?? workspacePort ?? cfg.values.port;
  const host = parsed.host ?? cfg.values.host;
  return { port, host, dataDir: parsed.dataDir, configPath: parsed.configPath, strictPort: parsed.strictPort };
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
    dbUrl !== undefined
      ? await createDb(dbUrl, cfg.values.dbToken)
      : await createDb(dbPath);
  if (dbUrl === undefined) {
    await migrate(db);
    // Local bootstrap: exactly one default org when none exist (REQ-21).
    await ensureDefaultOrg(db);
  }

  const storage =
    cfg.values.storage.kind === 's3'
      ? createS3Adapter({ db, config: cfg.values.storage })
      : undefined;
  const services = createServices({ db, ...(storage !== undefined ? { storage } : {}) });
  const tokenStore = {
    async verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
  const mcpApp = createMcpApp({ services, tokenStore });
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
  });
  // Node-only: serve the bundled web SPA from disk. Edge entries use platform assets.
  mountStatic(app);

  const server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });

  const logListening = (): void => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
    // Record the port this project actually bound, so other projects' `init`
    // avoids it even if this project predates the registry or rotated ports.
    reservePort(dataDir, boundPort);
    writeServerInfo(dataDir, {
      port: boundPort,
      pid: process.pid,
      host,
      startedAt: new Date().toISOString(),
    });
    process.stdout.write(`Plan Desk → http://${host}:${String(boundPort)}  (db: ${dbDisplay})\n`);
    if (boundPort !== options.port) {
      process.stdout.write(
        `Note: port ${String(options.port)} was in use — started on ${String(boundPort)}. ` +
          `An agent connected via 'plandesk connect' expects ${String(options.port)} and won't reach this instance; ` +
          `stop the other server, or reconnect with --url http://${host}:${String(boundPort)}.\n`,
      );
    }
  };

  server.once('close', () => {
    deleteServerInfo(dataDir);
  });

  // Strict mode: bind the requested port or fail (Vite's strictPort).
  if (options.strictPort === true) {
    server.on('error', createListenErrorHandler(options.port, exit));
    server.listen(options.port, host, logListening);
    return server;
  }

  // Default: rotate to another in-range port not owned by another project
  // (Vite/Expo-style, but registry-aware — sequential `port + attempt` could
  // bind a port a different live project owns).
  let attempt = 0;
  const triedPorts = new Set<number>([options.port]);
  const pickRotationCandidate = (): number | undefined => {
    const registry = readPortRegistry();
    const eligible: number[] = [];
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (triedPorts.has(port) || isPortOwnedByAnotherProject(registry, port, dataDir)) {
        continue;
      }
      eligible.push(port);
    }
    if (eligible.length === 0) {
      return undefined;
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
  };
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') {
      throw err;
    }
    attempt += 1;
    const candidate = attempt >= PORT_ROTATE_ATTEMPTS ? undefined : pickRotationCandidate();
    if (candidate === undefined) {
      process.stderr.write(
        `Error: no available port in range ${String(PORT_RANGE_START)}-${String(PORT_RANGE_END)} — all attempted ports are in use\n`,
      );
      exit(1);
      return;
    }
    triedPorts.add(candidate);
    server.listen(candidate, host);
  });
  server.once('listening', logListening);
  server.listen(options.port, host);

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
