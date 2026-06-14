import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createApp, createEventBus, createServices } from '@plandesk/api';
import { createDb, migrate, verifyToken } from '@plandesk/db';
import { createMcpApp } from '@plandesk/mcp';
import {
  isLoopbackHost,
  resolveAuthPassword,
  resolveBindHost,
  resolveDataDir,
  workspaceDbPath,
} from './args.js';
import { deleteServerInfo, writeServerInfo } from './connect-artifacts.js';

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

export function validateServeBind(
  options: ServeOptions,
  _exit: ExitFn = defaultExit,
): { host: string; authPassword?: string } {
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

export function startServer(options: ServeOptions, exit: ExitFn = defaultExit): Server {
  const { host, authPassword } = validateServeBind(options, exit);
  const dataDir = resolveDataDir(options.dataDir);
  const dbPath = workspaceDbPath(dataDir);
  const db = createDb(dbPath);
  migrate(db);

  const eventBus = createEventBus();
  const services = createServices({ db, eventBus });
  const tokenStore = {
    verify(raw: string) {
      return verifyToken(db, raw);
    },
  };
  const mcpApp = createMcpApp({ services, tokenStore });
  const app = createApp({ db, eventBus, services, mcp: mcpApp, authPassword });

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

  // Default: rotate to the next free port (Vite/Expo-style).
  let attempt = 0;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') {
      throw err;
    }
    attempt += 1;
    if (attempt >= PORT_ROTATE_ATTEMPTS) {
      const last = options.port + PORT_ROTATE_ATTEMPTS - 1;
      process.stderr.write(`Error: ports ${String(options.port)}-${String(last)} are all in use\n`);
      exit(1);
      return;
    }
    server.listen(options.port + attempt, host);
  });
  server.once('listening', logListening);
  server.listen(options.port, host);

  return server;
}

export function runServe(options: ServeOptions): Server {
  const server = startServer(options);
  const dataDir = resolveDataDir(options.dataDir);

  const shutdown = () => {
    deleteServerInfo(dataDir);
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}
