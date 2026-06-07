import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createApp } from '@plandesk/api';
import { createDb, migrate } from '@plandesk/db';
import { BIND_HOST, resolveDataDir, workspaceDbPath } from './args.js';

export type ServeOptions = {
  port: number;
  dataDir?: string;
};

export type ExitFn = (code: number) => never;

const defaultExit: ExitFn = (code) => {
  process.exit(code);
};

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
  const dataDir = resolveDataDir(options.dataDir);
  const db = createDb(workspaceDbPath(dataDir));
  migrate(db);
  const app = createApp({ db });

  const server = createServer((req, res) => {
    void getRequestListener(app.fetch)(req, res);
  });
  server.on('error', createListenErrorHandler(options.port, exit));
  server.listen(options.port, BIND_HOST, () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : options.port;
    process.stdout.write(`Plan Desk → http://${BIND_HOST}:${String(port)}\n`);
  });

  return server;
}

export function runServe(options: ServeOptions): Server {
  return startServer(options);
}
