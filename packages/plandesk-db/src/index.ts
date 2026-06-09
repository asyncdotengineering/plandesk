import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { createDb, type Db, type DbClient, type DbTx } from './client.js';
export { migrate } from './migrate.js';
export * from './repositories/projects.js';
export * from './repositories/tasks.js';
export * from './repositories/edges.js';
export * from './repositories/documents.js';
export * from './repositories/document-comments.js';
export * from './repositories/tokens.js';
export * from './repositories/shares.js';
export * from './repositories/agent-runs.js';
export * from './repositories/agent-run-events.js';
export * from './portability.js';
export { seed, FIXTURE_PROJECT_ID } from './seed.js';
export * from './schema.js';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');

export const version = (): string => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};
