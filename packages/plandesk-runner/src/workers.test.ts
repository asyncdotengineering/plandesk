import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findFactoryWorkersDir, listWorkerFiles } from './workers.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeFixtureRepo(workerNames: string[], extras: string[] = []): string {
  const repo = makeTempDir('plandesk-runner-repo-');
  const workersDir = join(repo, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  for (const name of workerNames) {
    writeFileSync(
      join(workersDir, `${name}.md`),
      `---\ntype: worker\nprobe: command -v ${name}\n---\n`,
    );
  }
  for (const extra of extras) {
    writeFileSync(join(workersDir, extra), 'not a worker\n');
  }
  return repo;
}

describe('listWorkerFiles', () => {
  it('lists one row per *.md worker file, sorted, ignoring non-worker entries', () => {
    const repo = makeFixtureRepo(['pi', 'codex'], ['README.txt', 'notes.markdown']);

    const files = listWorkerFiles(join(repo, '.agents', 'factory', 'workers'));

    expect(files).toEqual([
      {
        id: 'codex',
        path: join(repo, '.agents', 'factory', 'workers', 'codex.md'),
      },
      {
        id: 'pi',
        path: join(repo, '.agents', 'factory', 'workers', 'pi.md'),
      },
    ]);
  });

  it('returns an empty list when the directory does not exist', () => {
    const repo = makeTempDir('plandesk-runner-empty-');

    expect(listWorkerFiles(join(repo, '.agents', 'factory', 'workers'))).toEqual([]);
  });
});

describe('findFactoryWorkersDir', () => {
  it('finds the workers dir from a nested directory', () => {
    const repo = makeFixtureRepo(['pi']);
    const nested = join(repo, '.agents', 'factory', 'protocol');
    mkdirSync(nested, { recursive: true });

    expect(findFactoryWorkersDir(nested)).toBe(join(repo, '.agents', 'factory', 'workers'));
  });

  it('returns undefined when no workers dir exists up the tree', () => {
    const orphan = makeTempDir('plandesk-runner-orphan-');

    expect(findFactoryWorkersDir(orphan)).toBeUndefined();
  });
});
