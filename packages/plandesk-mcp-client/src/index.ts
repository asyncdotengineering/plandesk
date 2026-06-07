import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  createPlandeskClient,
  type PlandeskClient,
  type PlandeskClientOptions,
  type PlandeskProject,
  type PlandeskProjectDetail,
  type TaskStatusSummary,
} from './client.js';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');

export const version = (): string => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
};
