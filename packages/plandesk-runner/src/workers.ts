import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A worker declaration file found under `.agents/factory/workers/`. */
export interface WorkerFile {
  /** Worker id — the file name without the `.md` suffix (e.g. `pi`, `codex`). */
  id: string;
  /** Absolute path to the declaration file. */
  path: string;
}

/**
 * List the worker declaration files in a factory workers directory, sorted by
 * file name for deterministic output. Non-`.md` entries and subdirectories are
 * ignored. This is a listing only — probing installs is a later task.
 */
export function listWorkerFiles(workersDir: string): WorkerFile[] {
  if (!existsSync(workersDir)) {
    return [];
  }
  return readdirSync(workersDir)
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => ({ id: entry.slice(0, -'.md'.length), path: join(workersDir, entry) }));
}

/**
 * Walk up from `startDir` looking for a `.agents/factory/workers` directory.
 * Returns the first one found (absolute), or undefined. Searching for the
 * workers dir itself — rather than a `.git` marker — keeps this working in
 * worktrees and non-git checkouts.
 */
export function findFactoryWorkersDir(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.agents', 'factory', 'workers');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
