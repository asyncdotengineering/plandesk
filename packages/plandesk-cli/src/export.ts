import { writeFileSync } from 'node:fs';
import { exportProject, type Db } from '@plandesk/db';

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export async function runExport(db: Db, projectId: string, outPath: string): Promise<void> {
  const exported = await exportProject(db, projectId);
  if (exported === undefined) {
    throw new ProjectNotFoundError(projectId);
  }
  writeFileSync(outPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
}
