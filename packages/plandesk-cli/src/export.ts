import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportProject, type Db } from '@plandesk/db';

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

/** Marker file under the data dir — doctor reads this for backup status. */
export const LAST_EXPORT_FILE = 'last-export';

export function lastExportPath(dataDir: string): string {
  return join(dataDir, LAST_EXPORT_FILE);
}

export function recordLastExport(dataDir: string, at: Date = new Date()): void {
  writeFileSync(lastExportPath(dataDir), `${at.toISOString()}\n`, 'utf8');
}

export async function runExport(
  db: Db,
  projectId: string,
  outPath: string,
  dataDir?: string,
): Promise<void> {
  const exported = await exportProject(db, projectId);
  if (exported === undefined) {
    throw new ProjectNotFoundError(projectId);
  }
  writeFileSync(outPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
  if (dataDir !== undefined) {
    recordLastExport(dataDir);
  }
}
