import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { createDb, migrate } from '@plandesk/db';
import { resolveInitDataDir, workspaceDbPath } from './args.js';
import { readWorkspaceJson, writeWorkspaceJson } from './connect-artifacts.js';

const PORT_RANGE_START = 3400;
const PORT_RANGE_END = 3499;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function assignPort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`No available port in range ${PORT_RANGE_START}–${PORT_RANGE_END}`);
}

export async function runInit(dataDirOverride?: string): Promise<string> {
  const dataDir = resolveInitDataDir(dataDirOverride);
  mkdirSync(dataDir, { recursive: true });
  const dbPath = workspaceDbPath(dataDir);
  const db = createDb(dbPath);
  migrate(db);

  if (readWorkspaceJson(dataDir) === undefined) {
    const port = await assignPort();
    writeWorkspaceJson(dataDir, port);
  }

  return dbPath;
}
