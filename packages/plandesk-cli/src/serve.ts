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

export type ServeOptions = {
  port: number;
  dataDir?: string;
  host?: string;
  authPassword?: string;
};

export type ExitFn = (code: number) => never;

const defaultExit: ExitFn = (code) => {
  process.exit(code);
};

export function validateServeBind(
  options: ServeOptions,
  exit: ExitFn = defaultExit,
): { host: string; authPassword?: string } {
  const host = resolveBindHost(options.host);
  const authPassword = options.authPassword ?? resolveAuthPassword();

  if (!isLoopbackHost(host) && authPassword === undefined) {
    process.stderr.write(
      'Error: binding to a non-loopback address requires PLANDESK_AUTH_PASSWORD\n',
    );
    exit(1);
  }

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
  const db = createDb(workspaceDbPath(dataDir));
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
  server.on('error', createListenErrorHandler(options.port, exit));
  server.listen(options.port, host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : options.port;
    process.stdout.write(`Plan Desk → http://${host}:${String(port)}\n`);
  });

  return server;
}

export function runServe(options: ServeOptions): Server {
  return startServer(options);
}
