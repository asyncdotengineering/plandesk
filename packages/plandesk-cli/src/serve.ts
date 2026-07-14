import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createApp, createServices, mountStatic } from '@plandesk/api';
import { createDb, ensureDefaultOrg, migrate, verifyToken } from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import { resolveAuthPassword, resolveBindHost, resolveDataDir, workspaceDbPath } from './args.js';
import {
  deleteServerInfo,
  isPortOwnedByAnotherProject,
  readPortRegistry,
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

export async function startServer(
  options: ServeOptions,
  exit: ExitFn = defaultExit,
): Promise<Server> {
  const { host, authPassword } = validateServeBind(options);
  const dataDir = resolveDataDir(options.dataDir);
  const dbPath = workspaceDbPath(dataDir);
  const db = await createDb(dbPath);
  await migrate(db);
  // Local bootstrap: exactly one default org when none exist (REQ-21).
  await ensureDefaultOrg(db);

  const services = createServices({ db });
  const tokenStore = {
    async verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
  const mcpApp = createMcpApp({ services, tokenStore });
  const app = createApp({ db, services, mcp: mcpApp, authPassword, bindHost: host });
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
    process.stdout.write(`Plan Desk → http://${host}:${String(boundPort)}  (db: ${dbPath})\n`);
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
