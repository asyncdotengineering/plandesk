import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { createDb, migrate } from '@plandesk/db';
import { resolveInitDataDir, workspaceDbPath } from './args.js';
import {
  isPortOwnedByAnotherProject,
  readPortRegistry,
  readWorkspaceJson,
  reservePort,
  writeWorkspaceJson,
} from './connect-artifacts.js';

const PORT_RANGE_START = 3400;
const PORT_RANGE_END = 3499;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function assignPort(dataDir: string): Promise<number> {
  const registry = readPortRegistry();
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    // Skip ports another project already owns (even if that project's server is
    // not currently listening) and ports something is actively bound to.
    if (isPortOwnedByAnotherProject(registry, port, dataDir)) {
      continue;
    }
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port in range ${String(PORT_RANGE_START)}–${String(PORT_RANGE_END)}`,
  );
}

export async function runInit(dataDirOverride?: string): Promise<string> {
  const dataDir = resolveInitDataDir(dataDirOverride);
  mkdirSync(dataDir, { recursive: true });
  const dbPath = workspaceDbPath(dataDir);
  const db = createDb(dbPath);
  migrate(db);

  if (readWorkspaceJson(dataDir) === undefined) {
    const port = await assignPort(dataDir);
    writeWorkspaceJson(dataDir, port);
    reservePort(dataDir, port);
  }

  return dbPath;
}
