import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, migrate, type Db } from '@plandesk/db';
import { resolveDataDir, workspaceDbPath } from './args.js';

export const CORRUPT_DB_HINT =
  'Database appears corrupt or unreadable. Run `plandesk doctor` to diagnose.';

export class CorruptWorkspaceError extends Error {
  constructor() {
    super(CORRUPT_DB_HINT);
    this.name = 'CorruptWorkspaceError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceNotFoundError';
  }
}

// A connect-only repo has .plandesk/config.json but no workspace.db — the
// workspace lives wherever `plandesk serve` runs. Creating an empty db here
// (the old behavior) buried the real problem and left a stray 126KB file.
function workspaceNotFoundMessage(dataDir: string, dbPath: string): string {
  const configPath = join(dataDir, 'config.json');
  if (existsSync(configPath)) {
    let serverUrl = '';
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { serverUrl?: string };
      serverUrl = typeof config.serverUrl === 'string' ? ` (${config.serverUrl})` : '';
    } catch {
      // fall through with no server hint
    }
    return (
      `No workspace database at ${dbPath}. This directory has a connect binding${serverUrl} ` +
      `but no workspace — the workspace lives where \`plandesk serve\` runs. ` +
      `Run this command from that directory, or pass --data-dir <dir>. ` +
      `Run \`plandesk init\` only if you mean to create a new workspace here.`
    );
  }
  return `No workspace database at ${dbPath}. Run \`plandesk init\` first, or pass --data-dir <dir>.`;
}

function isCorruptionSignal(err: Error): boolean {
  const message = err.message.toLowerCase();
  if (
    message.includes('malformed') ||
    message.includes('not a database') ||
    message.includes('corrupt') ||
    message.includes('disk image')
  ) {
    return true;
  }
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB';
}

export function isDbCorruptionError(err: unknown): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    if (isCorruptionSignal(current)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

export async function openWorkspace(dataDirOverride?: string): Promise<{
  db: Db;
  dataDir: string;
  dbPath: string;
}> {
  const dataDir = resolveDataDir(dataDirOverride);
  const dbPath = workspaceDbPath(dataDir);
  if (!existsSync(dbPath)) {
    throw new WorkspaceNotFoundError(workspaceNotFoundMessage(dataDir, dbPath));
  }
  try {
    const db = await createDb(dbPath);
    await migrate(db);
    return { db, dataDir, dbPath };
  } catch (err) {
    if (isDbCorruptionError(err)) {
      throw new CorruptWorkspaceError();
    }
    throw err;
  }
}
