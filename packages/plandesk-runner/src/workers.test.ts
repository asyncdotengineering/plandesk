import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunnerConfig } from './config.js';
import {
  findFactoryWorkersDir,
  listWorkerFiles,
  NoUsableWorkersError,
  parseWorkerFrontmatter,
  pickWorker,
  resolveWorkers,
  type Worker,
} from './workers.js';

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

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    boardUrl: 'http://board.example.invalid',
    agentKey: 'test-agent-key',
    name: 'test-runner',
    workdir: '/tmp/plandesk-runner-test',
    workers: [],
    slots: 1,
    pollMs: 2000,
    leaseMs: 30000,
    heartbeatMs: 10000,
    attemptTimeoutMs: 3600000,
    repos: [],
    labels: {},
    ...overrides,
  };
}

/** Frontmatter for a well-formed worker: probe passes, headless present. */
function frontmatter(extra: Record<string, string> = {}): Record<string, string> {
  return {
    type: 'worker',
    probe: '"true"', // quoted so YAML keeps it a string, like `command -v pi` in real files
    headless: 'agent run {prompt_file}',
    ...extra,
  };
}

function makeWorktree(
  workers: Array<{ name: string; frontmatter: Record<string, string> }>,
): string {
  const repo = makeTempDir('plandesk-runner-wt-');
  const workersDir = join(repo, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  for (const { name, frontmatter: fm } of workers) {
    const body = Object.entries(fm)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    writeFileSync(join(workersDir, `${name}.md`), `---\n${body}\n---\n\n# ${name}\n`);
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

describe('parseWorkerFrontmatter', () => {
  it('reads the recognised keys and ignores the document body', () => {
    const content = [
      '---',
      'type: worker',
      'probe: command -v pi',
      'version: pi --version',
      'command: pi @{prompt_file}',
      'headless: pi --print',
      '---',
      '',
      '# body',
      'headless: not-frontmatter',
    ].join('\n');

    expect(parseWorkerFrontmatter(content)).toEqual({
      type: 'worker',
      probe: 'command -v pi',
      version: 'pi --version',
      command: 'pi @{prompt_file}',
      headless: 'pi --print',
    });
  });

  it('returns undefined for content with no frontmatter block', () => {
    expect(parseWorkerFrontmatter('# just markdown\n')).toBeUndefined();
  });

  it('returns undefined when the frontmatter is never closed', () => {
    expect(parseWorkerFrontmatter('---\ntype: worker\n')).toBeUndefined();
  });

  it('drops non-string and whitespace-only values', () => {
    expect(parseWorkerFrontmatter('---\nheadless: [a, b]\n---\n')).toEqual({});
    expect(parseWorkerFrontmatter('---\nheadless: "  "\n---\n')).toEqual({});
  });
});

describe('resolveWorkers', () => {
  it('excludes a file without a headless key and does not throw', async () => {
    const worktree = makeWorktree([
      { name: 'alpha', frontmatter: frontmatter() },
      {
        name: 'beta',
        frontmatter: { type: 'worker', probe: 'true', command: 'beta {prompt_file}' },
      },
    ]);

    const result = await resolveWorkers(worktree, makeConfig());

    expect(result.usable.map((worker) => worker.name)).toEqual(['alpha']);
    expect(result.excluded).toEqual([{ worker: 'beta', reason: 'no-headless-key' }]);
  });

  it('excludes a worker absent from config.workers', async () => {
    const worktree = makeWorktree([
      { name: 'alpha', frontmatter: frontmatter() },
      { name: 'beta', frontmatter: frontmatter() },
    ]);

    const result = await resolveWorkers(worktree, makeConfig({ workers: ['alpha'] }));

    expect(result.usable.map((worker) => worker.name)).toEqual(['alpha']);
    expect(result.excluded).toEqual([{ worker: 'beta', reason: 'not-enabled-in-config' }]);
  });

  it('accepts every repo-declared worker when config.workers is empty', async () => {
    const worktree = makeWorktree([
      { name: 'gamma', frontmatter: frontmatter() },
      { name: 'alpha', frontmatter: frontmatter() },
      { name: 'beta', frontmatter: frontmatter() },
    ]);

    const result = await resolveWorkers(worktree, makeConfig());

    expect(result.usable.map((worker) => worker.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.excluded).toEqual([]);
  });

  it('a failing probe excludes only that worker while the others still resolve', async () => {
    const worktree = makeWorktree([
      { name: 'good', frontmatter: frontmatter({ version: 'echo good-2.0' }) },
      { name: 'bad', frontmatter: frontmatter({ probe: 'echo probe-boom >&2; exit 3' }) },
    ]);

    const result = await resolveWorkers(worktree, makeConfig());

    expect(result.usable.map((worker) => worker.name)).toEqual(['good']);
    expect(result.usable[0]?.resolvedVersion).toBe('good-2.0');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.worker).toBe('bad');
    expect(result.excluded[0]?.reason).toBe('probe-failed');
    if (result.excluded[0]?.reason === 'probe-failed') {
      expect(result.excluded[0].stderr).toContain('probe-boom');
    }
  });

  it('captures the trimmed stdout of the version command as resolvedVersion', async () => {
    const worktree = makeWorktree([
      { name: 'v', frontmatter: frontmatter({ version: "echo '  9.9.9  '" }) },
      { name: 'noversion', frontmatter: frontmatter() },
    ]);

    const result = await resolveWorkers(worktree, makeConfig());

    expect(result.usable.find((worker) => worker.name === 'v')?.resolvedVersion).toBe('9.9.9');
    expect(
      result.usable.find((worker) => worker.name === 'noversion')?.resolvedVersion,
    ).toBeUndefined();
    expect(result.usable.find((worker) => worker.name === 'noversion')?.version).toBeUndefined();
  });

  it('keeps a worker usable when its version command fails', async () => {
    const worktree = makeWorktree([
      { name: 'v', frontmatter: frontmatter({ version: 'echo version-boom >&2; exit 1' }) },
    ]);

    const result = await resolveWorkers(worktree, makeConfig());

    expect(result.usable.map((worker) => worker.name)).toEqual(['v']);
    expect(result.usable[0]?.resolvedVersion).toBeUndefined();
  });

  it('derives usesPromptFile and usesResultFile from placeholder presence', async () => {
    const worktree = makeWorktree([
      {
        name: 'both',
        frontmatter: frontmatter({ headless: 'agent run {prompt_file} --out {result_file}' }),
      },
      { name: 'promptonly', frontmatter: frontmatter({ headless: 'agent run {prompt_file}' }) },
      { name: 'neither', frontmatter: frontmatter({ headless: 'agent run' }) },
    ]);

    const result = await resolveWorkers(worktree, makeConfig());
    const byName = new Map(result.usable.map((worker) => [worker.name, worker]));

    expect(byName.get('both')).toMatchObject({ usesPromptFile: true, usesResultFile: true });
    expect(byName.get('promptonly')).toMatchObject({ usesPromptFile: true, usesResultFile: false });
    expect(byName.get('neither')).toMatchObject({ usesPromptFile: false, usesResultFile: false });
  });

  it('throws NoUsableWorkersError naming the declared set, the enabled set, and every exclusion', async () => {
    const worktree = makeWorktree([
      { name: 'broken', frontmatter: frontmatter({ probe: 'echo dead >&2; exit 1' }) },
      {
        name: 'locked',
        frontmatter: { type: 'worker', probe: 'true', command: 'locked {prompt_file}' },
      },
    ]);

    let caught: unknown;
    try {
      await resolveWorkers(worktree, makeConfig({ workers: ['broken'] }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NoUsableWorkersError);
    const error = caught as NoUsableWorkersError;
    expect(error.declared).toEqual(['broken', 'locked']);
    expect(error.enabled).toEqual(['broken']);
    expect(error.excluded.map((exclusion) => exclusion.worker)).toEqual(['broken', 'locked']);
    expect(error.excluded[0]?.reason).toBe('probe-failed');
    if (error.excluded[0]?.reason === 'probe-failed') {
      expect(error.excluded[0].stderr).toContain('dead');
    }
    expect(error.excluded[1]).toEqual({ worker: 'locked', reason: 'no-headless-key' });
    expect(error.message).toContain('declared: [broken, locked]');
    expect(error.message).toContain('enabled: [broken]');
    expect(error.message).toContain('broken');
    expect(error.message).toContain('dead');
    expect(error.message).toContain('locked');
    expect(error.message).toContain('no headless key');
  });

  it('names the declared set as enabled when config.workers is empty and nothing resolves', async () => {
    const worktree = makeWorktree([
      { name: 'solo', frontmatter: frontmatter({ probe: 'exit 1' }) },
    ]);

    let caught: unknown;
    try {
      await resolveWorkers(worktree, makeConfig());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NoUsableWorkersError);
    const error = caught as NoUsableWorkersError;
    expect(error.declared).toEqual(['solo']);
    expect(error.enabled).toEqual(['solo']);
    expect(error.message).toContain('declared: [solo]');
    expect(error.message).toContain('enabled: [solo]');
  });

  it('throws when no workers directory exists anywhere above the worktree', async () => {
    const orphan = makeTempDir('plandesk-runner-noworkers-');

    await expect(resolveWorkers(orphan, makeConfig())).rejects.toBeInstanceOf(NoUsableWorkersError);
  });
});

describe('pickWorker', () => {
  const base = {
    probe: 'true',
    headless: 'agent run',
    usesPromptFile: false,
    usesResultFile: false,
  };
  const worker = (name: string): Worker => ({ name, ...base });

  it('prefers config.defaultWorker when it is usable', () => {
    const usable = [worker('alpha'), worker('zeta'), worker('mid')];

    expect(pickWorker(usable, makeConfig({ defaultWorker: 'zeta' })).name).toBe('zeta');
  });

  it('falls back to the first usable worker by name', () => {
    const usable = [worker('zeta'), worker('alpha')];

    expect(pickWorker(usable, makeConfig()).name).toBe('alpha');
    expect(pickWorker(usable, makeConfig({ defaultWorker: 'missing' })).name).toBe('alpha');
  });

  it('throws when the usable set is empty', () => {
    expect(() => pickWorker([], makeConfig())).toThrow('at least one usable worker');
  });
});
