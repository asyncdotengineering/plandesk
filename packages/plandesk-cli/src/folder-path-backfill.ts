import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getBoundProjectId, parseConfigJson } from './connect-artifacts.js';
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
  const configPath = join(plandeskDir, 'config.json');
  let config;
  try {
    config = parseConfigJson(readFileSync(configPath, 'utf8'));
  } catch {
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
