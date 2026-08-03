import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** Absolute, realpath-resolved repo root — same normalisation file_path uses. */
export function resolveRegisteredRepoRoot(repoDir: string): string {
  return realpathSync(resolve(repoDir));
}
