import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { createDb, ensureDefaultOrg, migrate } from '@plandesk/db';
import { resolveInitDataDir, workspaceDbPath } from './args.js';
import {
  isPortOwnedByAnotherProject,
  readPortRegistry,
  readWorkspaceJson,
  reservePort,
  writeWorkspaceJson,
} from './connect-artifacts.js';

export const PORT_RANGE_START = 3400;
export const PORT_RANGE_END = 3499;

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

// Random rather than lowest-first: a sequential scan piles every install onto
// 3400/3401/3402, so a legacy install that predates the registry (and thus
// isn't excluded by isPortOwnedByAnotherProject) is far more likely to collide
// with a fresh one. Spreading assignments across the whole range makes that
// collision rare instead of near-certain. `rng` is injectable so tests can
// pick a specific candidate deterministically.
export async function assignPort(
  dataDir: string,
  rng: () => number = Math.random,
): Promise<number> {
  const registry = readPortRegistry();
  const eligible: number[] = [];
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    // Skip ports another project already owns (even if that project's server is
    // not currently listening) and ports something is actively bound to.
    if (isPortOwnedByAnotherProject(registry, port, dataDir)) {
      continue;
    }
    if (await isPortFree(port)) {
      eligible.push(port);
    }
  }
  if (eligible.length === 0) {
    throw new Error(
      `No available port in range ${String(PORT_RANGE_START)}–${String(PORT_RANGE_END)}`,
    );
  }
  return eligible[Math.floor(rng() * eligible.length)] as number;
}

export async function runInit(dataDirOverride?: string): Promise<string> {
  const dataDir = resolveInitDataDir(dataDirOverride);
  mkdirSync(dataDir, { recursive: true });
  const dbPath = workspaceDbPath(dataDir);
  const db = await createDb(dbPath);
  await migrate(db);
  // Seed the single local org so loopback auth has a tenant (REQ-21).
  await ensureDefaultOrg(db);

  const existing = readWorkspaceJson(dataDir);
  if (existing === undefined) {
    const port = await assignPort(dataDir);
    writeWorkspaceJson(dataDir, port);
    reservePort(dataDir, port);
  } else if (readPortRegistry().assignments[String(existing.port)] !== dataDir) {
    // Legacy install: workspace.json predates the port registry, so this
    // project's port is invisible to other installs' assignPort. Backfill it
    // so a re-run of init/connect stops other installs from treating it as free.
    reservePort(dataDir, existing.port);
  }

  return dbPath;
}
