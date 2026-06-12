import { mkdirSync } from 'node:fs';
import { createDb, migrate } from '@plandesk/db';
import { resolveInitDataDir, workspaceDbPath } from './args.js';

export function runInit(dataDirOverride?: string): string {
  const dataDir = resolveInitDataDir(dataDirOverride);
  mkdirSync(dataDir, { recursive: true });
  const dbPath = workspaceDbPath(dataDir);
  const db = createDb(dbPath);
  migrate(db);
  return dbPath;
}
