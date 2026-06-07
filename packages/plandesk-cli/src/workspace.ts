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

export function openWorkspace(dataDirOverride?: string): {
  db: Db;
  dataDir: string;
  dbPath: string;
} {
  const dataDir = resolveDataDir(dataDirOverride);
  const dbPath = workspaceDbPath(dataDir);
  try {
    const db = createDb(dbPath);
    migrate(db);
    return { db, dataDir, dbPath };
  } catch (err) {
    if (isDbCorruptionError(err)) {
      throw new CorruptWorkspaceError();
    }
    throw err;
  }
}
