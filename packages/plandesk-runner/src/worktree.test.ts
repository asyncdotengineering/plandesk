import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunnerConfig } from './config.js';
import {
  ensureRepo,
  GitError,
  prepareWorktree,
  resolveBaseCommit,
  retainOrRemove,
  type Worktree,
} from './worktree.js';

// These tests run against real temporary git repositories — a mocked git
// proves nothing about worktree semantics. Each fixture builds a bare
// "origin" remote, pushes one commit that carries a .gitignore for
// node_modules/, and clones it through ensureRepo exactly as the runner will.

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

function makeConfig(workdir: string): RunnerConfig {
  return {
    boardUrl: 'http://board.example.invalid',
    agentKey: 'test-agent-key',
    name: 'test-runner',
    workdir,
    workers: [],
    slots: 1,
    pollMs: 2000,
    leaseMs: 30000,
    heartbeatMs: 10000,
    attemptTimeoutMs: 3600000,
    repos: [],
    labels: {},
  };
}

/** Run one git command for fixture setup as an argv array; throws on failure. */
function gitRun(cwd: string | undefined, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run one git command as an argv array and return its trimmed stdout. */
function gitText(cwd: string | undefined, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const COMMIT_ARGS = ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t'];

interface Fixture {
  config: RunnerConfig;
  workdir: string;
  remoteUrl: string;
  seedDir: string;
  repoDir: string;
  baseOid: string;
}

async function makeFixture(): Promise<Fixture> {
  const root = makeTempDir('plandesk-runner-wt-');
  const workdir = join(root, 'work');
  mkdirSync(workdir, { recursive: true });
  const config = makeConfig(workdir);

  const remoteUrl = join(root, 'remote.git');
  gitRun(undefined, ['init', '--bare', '-b', 'main', remoteUrl]);

  const seedDir = join(root, 'seed');
  gitRun(undefined, ['init', '-b', 'main', seedDir]);
  writeFileSync(join(seedDir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(seedDir, 'file.txt'), 'initial\n');
  gitRun(seedDir, [...COMMIT_ARGS, 'add', '.']);
  gitRun(seedDir, [...COMMIT_ARGS, 'commit', '-m', 'init']);
  gitRun(seedDir, ['remote', 'add', 'origin', remoteUrl]);
  gitRun(seedDir, ['push', '-q', '-u', 'origin', 'main']);

  const repoDir = await ensureRepo(remoteUrl, config);
  const baseOid = await resolveBaseCommit(repoDir);
  return { config, workdir, remoteUrl, seedDir, repoDir, baseOid };
}

/** Commit one change on the worktree's branch from inside the worktree. */
function commitInWorktree(dir: string, message: string): void {
  gitRun(dir, [...COMMIT_ARGS, 'commit', '--allow-empty', '-m', message]);
}

describe('ensureRepo', () => {
  it('clones on first use under <workdir>/repos/<slug> and returns the same path afterwards', async () => {
    const fixture = await makeFixture();

    expect(existsSync(join(fixture.repoDir, '.git'))).toBe(true);
    expect(fixture.repoDir).toBe(join(fixture.workdir, 'repos', 'remote'));

    const again = await ensureRepo(fixture.remoteUrl, fixture.config);
    expect(again).toBe(fixture.repoDir);
  }, 30_000);

  it('refuses to clone over a directory that exists but is not a git clone', async () => {
    const fixture = await makeFixture();
    const busySlugDir = join(fixture.workdir, 'repos', 'busy');
    mkdirSync(busySlugDir, { recursive: true });
    writeFileSync(join(busySlugDir, 'data.txt'), 'not a clone\n');
    const busyRemote = fixture.remoteUrl.replace('remote.git', 'busy.git');
    gitRun(undefined, ['init', '--bare', '-b', 'main', busyRemote]);

    await expect(ensureRepo(busyRemote, fixture.config)).rejects.toMatchObject({
      name: 'WorktreeError',
      field: 'repoUrl',
    });
    expect(existsSync(join(busySlugDir, 'data.txt'))).toBe(true);
  }, 30_000);
});

describe('resolveBaseCommit', () => {
  it('returns the full OID the remote default branch advertises', async () => {
    const fixture = await makeFixture();
    const advertised = gitText(undefined, ['ls-remote', fixture.remoteUrl, 'refs/heads/main']).split('\t')[0];

    expect(fixture.baseOid).toMatch(/^[0-9a-f]{40}$/);
    expect(fixture.baseOid).toBe(advertised);
  }, 30_000);

  it('fetches before resolving, so a new remote commit yields a new OID', async () => {
    const fixture = await makeFixture();
    writeFileSync(join(fixture.seedDir, 'file.txt'), 'second\n');
    gitRun(fixture.seedDir, [...COMMIT_ARGS, 'commit', '-am', 'second']);
    gitRun(fixture.seedDir, ['push', '-q', 'origin', 'main']);

    const nextOid = await resolveBaseCommit(fixture.repoDir);

    expect(nextOid).toMatch(/^[0-9a-f]{40}$/);
    expect(nextOid).not.toBe(fixture.baseOid);
  }, 30_000);
});

describe('prepareWorktree', () => {
  it('creates a registered worktree at exactly the OID resolveBaseCommit returned', async () => {
    const fixture = await makeFixture();

    const wt = await prepareWorktree(fixture.repoDir, 't1', fixture.baseOid, fixture.config);

    expect(wt).toEqual({
      dir: join(fixture.workdir, 'worktrees', 't1'),
      branch: 'task/t1',
      baseOid: fixture.baseOid,
      repoSlug: 'remote',
    });
    expect(gitText(wt.dir, ['rev-parse', 'HEAD'])).toBe(fixture.baseOid);
    const registered = gitText(fixture.repoDir, ['worktree', 'list', '--porcelain']);
    expect(registered).toContain(realpathSync(wt.dir));
    expect(registered).toContain('branch refs/heads/task/t1');
  }, 30_000);

  it('rejects a base commit that is not a full OID', async () => {
    const fixture = await makeFixture();

    await expect(prepareWorktree(fixture.repoDir, 't2', 'main', fixture.config)).rejects.toMatchObject({
      name: 'WorktreeError',
      field: 'baseOid',
    });
  }, 30_000);

  it('fails with GitError carrying the exact argv when git itself fails', async () => {
    const fixture = await makeFixture();
    const missingOid = 'de'.repeat(20);

    const caught = await prepareWorktree(fixture.repoDir, 't3', missingOid, fixture.config).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(GitError);
    expect(caught).toMatchObject({
      argv: [
        'worktree',
        'add',
        '-b',
        'task/t3',
        join(fixture.workdir, 'worktrees', 't3'),
        missingOid,
      ],
    });
    expect((caught as GitError).stderr.trim().length).toBeGreaterThan(0);
  }, 30_000);

  it('sanitizes task ids with shell metacharacters into safe branches and dirs, executing no shell', async () => {
    const fixture = await makeFixture();
    // The classic injection probes: if any command reached a shell, /tmp/x
    // would be deleted and $(whoami) would have been expanded to the user.
    const markerDir = '/tmp/x';
    const markerFile = join(markerDir, 'plandesk-runner-marker.txt');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(markerFile, 'must survive\n');
    const username = gitText(undefined, ['config', '--get', 'user.name']);

    try {
      const wtA = await prepareWorktree(fixture.repoDir, 'a;rm -rf /tmp/x', fixture.baseOid, fixture.config);
      const wtB = await prepareWorktree(fixture.repoDir, '$(whoami)', fixture.baseOid, fixture.config);

      expect(wtA.branch).toBe('task/a-rm--rf--tmp-x');
      expect(wtA.dir).toBe(join(fixture.workdir, 'worktrees', 'a-rm--rf--tmp-x'));
      expect(wtB.branch).toBe('task/--whoami-');
      expect(wtB.branch).not.toContain(username);
      expect(gitText(fixture.repoDir, ['rev-parse', '--verify', wtA.branch])).toBe(fixture.baseOid);
      expect(gitText(fixture.repoDir, ['rev-parse', '--verify', wtB.branch])).toBe(fixture.baseOid);
      expect(gitText(wtA.dir, ['rev-parse', 'HEAD'])).toBe(fixture.baseOid);
      expect(gitText(wtB.dir, ['rev-parse', 'HEAD'])).toBe(fixture.baseOid);
      expect(existsSync(markerFile)).toBe(true);
    } finally {
      rmSync(markerFile, { force: true });
      try {
        rmSync(markerDir, { force: true });
      } catch {
        // /tmp/x existed before or gained other content; leave it alone
      }
    }
  }, 30_000);

  it('rejects a task id that sanitizes to nothing usable', async () => {
    const fixture = await makeFixture();

    await expect(prepareWorktree(fixture.repoDir, '..', fixture.baseOid, fixture.config)).rejects.toMatchObject({
      name: 'WorktreeError',
      field: 'taskId',
    });
  }, 30_000);

  it('refuses to prepare over an existing worktree directory', async () => {
    const fixture = await makeFixture();
    await prepareWorktree(fixture.repoDir, 't4', fixture.baseOid, fixture.config);

    await expect(prepareWorktree(fixture.repoDir, 't4', fixture.baseOid, fixture.config)).rejects.toMatchObject(
      { name: 'WorktreeError', field: 'taskId' },
    );
  }, 30_000);
});

describe('retainOrRemove', () => {
  it('removes a clean, unchanged worktree at the base commit when outcome is done', async () => {
    const fixture = await makeFixture();
    const wt = await prepareWorktree(fixture.repoDir, 'r1', fixture.baseOid, fixture.config);

    const decision = await retainOrRemove(fixture.repoDir, wt, 'done');

    expect(decision).toEqual({ action: 'removed', ignoredPaths: [] });
    expect(existsSync(wt.dir)).toBe(false);
    expect(gitText(fixture.repoDir, ['worktree', 'list', '--porcelain'])).not.toContain('refs/heads/task/r1');
  }, 30_000);

  it('removes a clean worktree whose branch is provably pushed', async () => {
    const fixture = await makeFixture();
    const wt = await prepareWorktree(fixture.repoDir, 'r2', fixture.baseOid, fixture.config);
    commitInWorktree(wt.dir, 'work');
    gitRun(wt.dir, ['push', '-q', 'origin', wt.branch]);
    gitRun(fixture.repoDir, ['fetch', '-q', '--prune', 'origin']);

    const decision = await retainOrRemove(fixture.repoDir, wt, 'done');

    expect(decision).toEqual({ action: 'removed', ignoredPaths: [] });
    expect(existsSync(wt.dir)).toBe(false);
    expect(gitText(fixture.repoDir, ['worktree', 'list', '--porcelain'])).not.toContain('refs/heads/task/r2');
    // The branch itself is preserved even though the worktree is gone.
    expect(gitText(fixture.repoDir, ['rev-parse', '--verify', wt.branch])).toBe(
      gitText(fixture.repoDir, ['rev-parse', '--verify', `origin/${wt.branch}`]),
    );
  }, 30_000);

  it('retains a dirty worktree with reason dirty and lists the files', async () => {
    const fixture = await makeFixture();
    const wt = await prepareWorktree(fixture.repoDir, 'r3', fixture.baseOid, fixture.config);
    writeFileSync(join(wt.dir, 'file.txt'), 'modified\n');
    writeFileSync(join(wt.dir, 'untracked.txt'), 'new\n');

    const decision = await retainOrRemove(fixture.repoDir, wt, 'done');

    expect(decision.action).toBe('retained');
    if (decision.action !== 'retained') {
      throw new Error(`expected a retained decision, got ${JSON.stringify(decision)}`);
    }
    expect(decision.reason).toBe('dirty');
    expect(decision.detail).toContain('file.txt');
    expect(decision.detail).toContain('untracked.txt');
    expect(existsSync(wt.dir)).toBe(true);
    expect(existsSync(join(wt.dir, 'untracked.txt'))).toBe(true);
  }, 30_000);

  it('retains a clean but unpushed branch with reason unpushed', async () => {
    const fixture = await makeFixture();
    const wt = await prepareWorktree(fixture.repoDir, 'r4', fixture.baseOid, fixture.config);
    commitInWorktree(wt.dir, 'never pushed');

    const decision = await retainOrRemove(fixture.repoDir, wt, 'done');

    expect(decision.action).toBe('retained');
    if (decision.action !== 'retained') {
      throw new Error(`expected a retained decision, got ${JSON.stringify(decision)}`);
    }
    expect(decision.reason).toBe('unpushed');
    expect(decision.detail).toContain('task/r4');
    expect(existsSync(wt.dir)).toBe(true);
  }, 30_000);

  it('retains a directory that is not a registered worktree with reason unproven, leaving it on disk', async () => {
    const fixture = await makeFixture();
    const ghostDir = join(fixture.workdir, 'worktrees', 'ghost');
    mkdirSync(ghostDir, { recursive: true });
    writeFileSync(join(ghostDir, 'human-data.txt'), 'do not delete\n');
    const ghost: Worktree = {
      dir: ghostDir,
      branch: 'task/ghost',
      baseOid: fixture.baseOid,
      repoSlug: 'remote',
    };

    const decision = await retainOrRemove(fixture.repoDir, ghost, 'done');

    expect(decision.action).toBe('retained');
    if (decision.action !== 'retained') {
      throw new Error(`expected a retained decision, got ${JSON.stringify(decision)}`);
    }
    expect(decision.reason).toBe('unproven');
    expect(decision.detail).toContain(ghostDir);
    expect(existsSync(join(ghostDir, 'human-data.txt'))).toBe(true);
  }, 30_000);

  it.each(['failed', 'needs_input'] as const)(
    'retains regardless of cleanliness when outcome is %s',
    async (outcome) => {
      const fixture = await makeFixture();
      const wt = await prepareWorktree(fixture.repoDir, `r-${outcome}`, fixture.baseOid, fixture.config);
      commitInWorktree(wt.dir, 'pushed but not done');
      gitRun(wt.dir, ['push', '-q', 'origin', wt.branch]);
      gitRun(fixture.repoDir, ['fetch', '-q', '--prune', 'origin']);

      const decision = await retainOrRemove(fixture.repoDir, wt, outcome);

      expect(decision.action).toBe('retained');
      if (decision.action !== 'retained') {
        throw new Error(`expected a retained decision, got ${JSON.stringify(decision)}`);
      }
      expect(decision.reason).toBe('outcome-not-done');
      expect(decision.detail).toContain(outcome);
      expect(existsSync(wt.dir)).toBe(true);
    },
    30_000,
  );

  it('does not let ignored-only node_modules block removal and lists it in ignoredPaths', async () => {
    const fixture = await makeFixture();
    const wt = await prepareWorktree(fixture.repoDir, 'r5', fixture.baseOid, fixture.config);
    const pkgDir = join(wt.dir, 'node_modules', 'left-pad');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'index.js'), 'module.exports = 1;\n');

    const decision = await retainOrRemove(fixture.repoDir, wt, 'done');

    expect(decision).toEqual({
      action: 'removed',
      ignoredPaths: ['node_modules/'],
    });
    expect(existsSync(wt.dir)).toBe(false);
  }, 30_000);

  it('retains with reason unproven when the registered branch does not match the record', async () => {
    const fixture = await makeFixture();
    const wt = await prepareWorktree(fixture.repoDir, 'r6', fixture.baseOid, fixture.config);
    const lying: Worktree = { ...wt, branch: 'task/something-else' };

    const decision = await retainOrRemove(fixture.repoDir, lying, 'done');

    expect(decision.action).toBe('retained');
    if (decision.action !== 'retained') {
      throw new Error(`expected a retained decision, got ${JSON.stringify(decision)}`);
    }
    expect(decision.reason).toBe('unproven');
    expect(decision.detail).toContain('task/something-else');
    expect(existsSync(wt.dir)).toBe(true);
  }, 30_000);
});
