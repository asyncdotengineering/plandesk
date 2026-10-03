import { dirname } from 'node:path';
import { getBoundProjectId, readPlandeskConfig } from './connect-artifacts.js';
import { findLocalPlandeskDir } from './args.js';
import { resolveRegisteredRepoRoot } from './repo-root.js';
import { getProject, updateProject, type Db } from '@plandesk/db';

export async function backfillRepoFolderPathFromCwd(
  db: Db,
  cwd: string = process.cwd(),
): Promise<
  { projectId: string; folderPath: string; status: 'set' | 'unchanged' | 'conflict' } | undefined
> {
  const plandeskDir = findLocalPlandeskDir(cwd);
  if (plandeskDir === undefined) {
    return undefined;
  }
  let config;
  try {
    config = readPlandeskConfig(dirname(plandeskDir));
  } catch {
    return undefined;
  }
  if (config === undefined) {
    return undefined;
  }
  const projectId = getBoundProjectId(config);
  if (projectId === undefined) {
    return undefined;
  }
  const project = await getProject(db, projectId);
  if (project === undefined) {
    return undefined;
  }
  const repoRoot = resolveRegisteredRepoRoot(dirname(plandeskDir));
  if (project.folderPath === null) {
    await updateProject(db, projectId, { folderPath: repoRoot });
    return { projectId, folderPath: repoRoot, status: 'set' };
  }
  if (project.folderPath === repoRoot) {
    return { projectId, folderPath: repoRoot, status: 'unchanged' };
  }
  return { projectId, folderPath: repoRoot, status: 'conflict' };
}
