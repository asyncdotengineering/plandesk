import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { createDb, withTransaction, type Client, type Db, type DbClient, type DbTx } from './client.js';
export { migrate } from './migrate.js';
export * from './repositories/projects.js';
export * from './repositories/goals.js';
export * from './repositories/tasks.js';
export * from './repositories/tags.js';
export * from './repositories/edges.js';
export * from './repositories/documents.js';
export * from './repositories/folders.js';
export * from './repositories/notes.js';
export * from './repositories/files.js';
export * from './repositories/artifacts.js';
export * from './repositories/comments.js';
export * from './repositories/shares.js';
export * from './repositories/guest-sessions.js';
export * from './repositories/share-submissions.js';
export * from './repositories/sync-remotes.js';
export * from './repositories/agent-runs.js';
export * from './repositories/agent-run-events.js';
export * from './portability.js';
export { seed, FIXTURE_PROJECT_ID } from './seed.js';
export {
  createProjectInDefaultOrg,
  listProjectsInDefaultOrg,
  createTaskWithDefaultGoal,
} from './testing.js';
export * from './schema.js';
export { isValidFolderPath, isValidRepoUrl } from './project-binding.js';

export const version = (): string => {
  // Lazy: module-level fileURLToPath(import.meta.url) breaks the Cloudflare
  // Workers bundle. Resolve only when version() is actually called.
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};
