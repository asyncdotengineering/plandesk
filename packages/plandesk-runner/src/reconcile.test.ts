import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunnerConfig } from './config.js';
import { BoardError, type BoardAgentRun, type BoardClient, type BoardTask } from './board.js';
import { ensureRepo, prepareWorktree, resolveBaseCommit } from './worktree.js';
import { reconcile, scanOrphans } from './reconcile.js';

// Reconciliation is asserted against a stub board (the classification
// contract) and against real temporary git repositories — a mocked git proves
// nothing about worktree registration evidence. Each fixture builds a bare
// "origin" remote and clones it into the runner workdir exactly as
// ensureRepo will, then prepares worktrees through prepareWorktree.

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
    agentKey: 'sk-test-reconcile-key',
    name: 'test-runner',
    workdir,
    workers: [],
    slots: 1,
    pollMs: 2000,
    leaseMs: 30000,
    heartbeatMs: 10000,
    attemptTimeoutMs: 30000,
    repos: [],
    labels: {},
  };
}

function makeTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    goal_id: null,
    label: 'Frobnicate the widget',
    status: 'in_progress',
    kind: 'feature',
    priority: null,
    lane: 'auto',
    severity: null,
    description: 'Make the widget frob.',
    assignee: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<BoardAgentRun> = {}): BoardAgentRun {
  return {
    id: 'run-1',
    project_id: 'proj-1',
    status: 'running',
    // runOnce labels every run it starts `task <taskId>: <label>`.
    label: 'task task-1: Frobnicate the widget',
    started_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The stub board. listTasks behaviors are consumed per call so one orphan's
// board failure never shadows another's; every method records a token.
// ---------------------------------------------------------------------------

class StubBoard implements BoardClient {
  readonly calls: string[] = [];
  readonly progress: Array<{ runId: string; message: string }> = [];
  readonly statuses: Array<{ taskId: string; status: string; runId: string }> = [];
  listTasksResult: BoardTask[] = [];
  /** One entry per listTasks call (last entry repeats when exhausted). */
  listTasksBehaviors: Array<BoardTask[] | Error> = [];
  listRunsResult: BoardAgentRun[] = [];
  progressError: Error | undefined;
  statusError: Error | undefined;
  private listTasksCalls = 0;

  nextTask(): Promise<BoardTask | null> {
    this.calls.push('nextTask');
    return Promise.resolve(null);
  }

  claimTask(): Promise<{ claimed: false } | { claimed: true; task: BoardTask }> {
    this.calls.push('claimTask');
    return Promise.resolve({ claimed: false });
  }

  setTaskStatus(taskId: string, status: string, runId: string): Promise<void> {
    this.calls.push(`setTaskStatus:${status}`);
    this.statuses.push({ taskId, status, runId });
    if (this.statusError !== undefined) {
      return Promise.reject(this.statusError);
    }
    return Promise.resolve();
  }

  project(): Promise<{ id: string; name: string; repo_url: string | null }> {
    this.calls.push('project');
    return Promise.resolve({ id: 'proj-1', name: 'Fixture', repo_url: null });
  }

  startRun(): Promise<BoardAgentRun> {
    this.calls.push('startRun');
    // POST /projects/:id/agent-runs is not a route on this board; reconcile
    // must never call this. The token records it if it ever does.
    return Promise.resolve(makeRun());
  }

  recordProgress(runId: string, message: string): Promise<void> {
    this.calls.push('recordProgress');
    this.progress.push({ runId, message });
    if (this.progressError !== undefined) {
      return Promise.reject(this.progressError);
    }
    return Promise.resolve();
  }

  completeRun(runId: string, status: 'completed' | 'failed'): Promise<void> {
    this.calls.push(`completeRun:${status}`);
    return Promise.resolve();
  }

  taskDocument(): Promise<null> {
    this.calls.push('taskDocument');
    return Promise.resolve(null);
  }

  listTasks(): Promise<BoardTask[]> {
    this.calls.push('listTasks');
    const behavior = this.listTasksBehaviors[this.listTasksCalls];
    this.listTasksCalls += 1;
    if (behavior instanceof Error) {
      return Promise.reject(behavior);
    }
    if (behavior !== undefined) {
      return Promise.resolve(behavior);
    }
    return Promise.resolve(this.listTasksResult);
  }

  listRuns(): Promise<BoardAgentRun[]> {
    this.calls.push('listRuns');
    return Promise.resolve(this.listRunsResult);
  }
}

// ---------------------------------------------------------------------------
// A real git fixture: bare remote cloned into <workdir>/repos, so prepared
// worktrees carry genuine `git worktree list` registrations.
// ---------------------------------------------------------------------------

const COMMIT_ARGS = ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t'];

function gitRun(cwd: string | undefined, args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

interface ReconcileFixture {
  config: RunnerConfig;
  workdir: string;
  repoDir: string;
  baseOid: string;
}

async function makeFixture(): Promise<ReconcileFixture> {
  const root = makeTempDir('plandesk-runner-reconcile-');
  const workdir = join(root, 'work');
  mkdirSync(workdir, { recursive: true });
  const config = makeConfig(workdir);

  const remoteUrl = join(root, 'remote.git');
  gitRun(undefined, ['init', '--bare', '-b', 'main', remoteUrl]);
  const seedDir = join(root, 'seed');
  gitRun(undefined, ['init', '-b', 'main', seedDir]);
  writeFileSync(join(seedDir, 'README.md'), '# fixture\n');
  gitRun(seedDir, [...COMMIT_ARGS, 'add', '.']);
  gitRun(seedDir, [...COMMIT_ARGS, 'commit', '-m', 'init']);
  gitRun(seedDir, ['remote', 'add', 'origin', remoteUrl]);
  gitRun(seedDir, ['push', '-q', '-u', 'origin', 'main']);

  const repoDir = await ensureRepo(remoteUrl, config);
  const baseOid = await resolveBaseCommit(repoDir);
  return { config, workdir, repoDir, baseOid };
}

async function prepareRegisteredWorktree(
  fixture: ReconcileFixture,
  taskId: string,
): Promise<string> {
  const wt = await prepareWorktree(fixture.repoDir, taskId, fixture.baseOid, fixture.config);
  return wt.dir;
}

describe('scanOrphans', () => {
  it('resolves [] when the worktrees directory does not exist', async () => {
    const workdir = makeTempDir('plandesk-scan-');
    await expect(scanOrphans(makeConfig(workdir))).resolves.toEqual([]);
  });

  it('derives taskId from prepared worktree directories, sorted, skipping files', async () => {
    const fixture = await makeFixture();
    const dirTwo = await prepareRegisteredWorktree(fixture, 'task-2');
    const dirOne = await prepareRegisteredWorktree(fixture, 'task-1');
    writeFileSync(join(fixture.workdir, 'worktrees', 'not-a-directory'), 'stray file');

    await expect(scanOrphans(fixture.config)).resolves.toEqual([
      { taskId: 'task-1', worktreeDir: dirOne },
      { taskId: 'task-2', worktreeDir: dirTwo },
    ]);
  }, 60_000);

  it('includes a plain directory with no git registration — the directory is the evidence', async () => {
    const workdir = makeTempDir('plandesk-scan-');
    mkdirSync(join(workdir, 'worktrees', 'task-9'), { recursive: true });

    await expect(scanOrphans(makeConfig(workdir))).resolves.toEqual([
      { taskId: 'task-9', worktreeDir: join(workdir, 'worktrees', 'task-9') },
    ]);
  });
});

describe('reconcile', () => {
  it('returns an in_progress task to todo, narrating on its still-running run, and never starts a fresh run', async () => {
    const fixture = await makeFixture();
    const dir = await prepareRegisteredWorktree(fixture, 'task-1');
    const board = new StubBoard();
    // Newest first, as the board's run list is sorted: a terminal run for the
    // same task must not be picked over the still-running one.
    board.listTasksResult = [makeTask()];
    board.listRunsResult = [
      makeRun({ id: 'run-old', status: 'completed', completed_at: new Date().toISOString() }),
      makeRun({ id: 'run-1' }),
    ];

    const orphans = await reconcile(board, fixture.config);

    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      taskId: 'task-1',
      worktreeDir: dir,
      boardStatus: 'in_progress',
      action: 'returned-to-todo',
    });
    expect(orphans[0]?.detail).toContain(dir);
    expect(orphans[0]?.detail).toContain('git worktree registered on refs/heads/task/task-1');
    // The interruption is explained on the interrupted attempt's own run,
    // naming the retained worktree path — no fresh run was opened.
    expect(board.progress).toHaveLength(1);
    expect(board.progress[0]?.runId).toBe('run-1');
    expect(board.progress[0]?.message).toContain('returned to todo');
    expect(board.progress[0]?.message).toContain(dir);
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'todo', runId: 'run-1' }]);
    expect(board.calls).not.toContain('startRun');
    // The worktree still exists on disk after reconcile.
    expect(existsSync(dir)).toBe(true);
  }, 60_000);

  it('classifies a directory with no git registration from board evidence alone', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    const dir = join(workdir, 'worktrees', 'task-9');
    mkdirSync(dir, { recursive: true });
    const board = new StubBoard();
    board.listTasksResult = [makeTask({ id: 'task-9' })];
    board.listRunsResult = [makeRun({ id: 'run-9', label: 'task task-9: Frobnicate the widget' })];

    const orphans = await reconcile(board, makeConfig(workdir));

    expect(orphans[0]).toMatchObject({ taskId: 'task-9', action: 'returned-to-todo' });
    expect(orphans[0]?.detail).toContain('directory evidence only');
    expect(board.statuses).toEqual([{ taskId: 'task-9', status: 'todo', runId: 'run-9' }]);
    expect(existsSync(dir)).toBe(true);
  });

  it('reports left-alone and retains the worktree when the task no longer exists', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    const dir = join(workdir, 'worktrees', 'task-gone');
    mkdirSync(dir, { recursive: true });
    const board = new StubBoard();
    board.listTasksResult = [makeTask({ id: 'task-other' })];

    const orphans = await reconcile(board, makeConfig(workdir));

    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      taskId: 'task-gone',
      boardStatus: null,
      action: 'left-alone',
    });
    expect(orphans[0]?.detail).toContain(dir);
    expect(board.statuses).toEqual([]);
    expect(board.calls).not.toContain('listRuns');
    expect(existsSync(dir)).toBe(true);
  });

  it('leaves a done task and a todo task alone — no in-flight attempt to release', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    const dirDone = join(workdir, 'worktrees', 'task-done');
    const dirTodo = join(workdir, 'worktrees', 'task-todo');
    mkdirSync(dirDone, { recursive: true });
    mkdirSync(dirTodo, { recursive: true });
    const board = new StubBoard();
    board.listTasksResult = [
      makeTask({ id: 'task-done', status: 'done' }),
      makeTask({ id: 'task-todo', status: 'todo' }),
    ];

    const orphans = await reconcile(board, makeConfig(workdir));

    expect(orphans).toHaveLength(2);
    expect(orphans[0]).toMatchObject({
      taskId: 'task-done',
      boardStatus: 'done',
      action: 'left-alone',
    });
    expect(orphans[1]).toMatchObject({
      taskId: 'task-todo',
      boardStatus: 'todo',
      action: 'left-alone',
    });
    expect(board.statuses).toEqual([]);
    expect(board.calls).not.toContain('listRuns');
    expect(existsSync(dirDone)).toBe(true);
    expect(existsSync(dirTodo)).toBe(true);
  });

  it('marks unresolvable and settles nothing when no running run can carry the release', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    const dir = join(workdir, 'worktrees', 'task-1');
    mkdirSync(dir, { recursive: true });
    const board = new StubBoard();
    board.listTasksResult = [makeTask()];
    board.listRunsResult = [
      makeRun({ id: 'run-old', status: 'failed', completed_at: new Date().toISOString() }),
    ];

    const orphans = await reconcile(board, makeConfig(workdir));

    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      taskId: 'task-1',
      boardStatus: 'in_progress',
      action: 'unresolvable',
    });
    expect(orphans[0]?.detail).toContain('no running agent run');
    expect(board.statuses).toEqual([]);
    expect(board.progress).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });

  it('a board error on one orphan does not abort the others, and reconcile never throws', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    const dirA = join(workdir, 'worktrees', 'task-a');
    const dirB = join(workdir, 'worktrees', 'task-b');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const board = new StubBoard();
    board.listTasksBehaviors = [
      new BoardError('http', 'GET', '/api/v1/projects/proj-1/tasks', 'board is down', {
        status: 503,
      }),
      [makeTask({ id: 'task-b' })],
    ];
    board.listRunsResult = [makeRun({ id: 'run-b', label: 'task task-b: Frobnicate the widget' })];

    const orphans = await reconcile(board, makeConfig(workdir));
    expect(orphans).toHaveLength(2);

    expect(orphans[0]).toMatchObject({ taskId: 'task-a', action: 'unresolvable' });
    expect(orphans[0]?.boardStatus).toBeNull();
    expect(orphans[0]?.detail).toContain('board is down');
    expect(orphans[1]).toMatchObject({ taskId: 'task-b', action: 'returned-to-todo' });
    expect(board.statuses).toEqual([{ taskId: 'task-b', status: 'todo', runId: 'run-b' }]);
    expect(existsSync(dirA)).toBe(true);
    expect(existsSync(dirB)).toBe(true);
  });

  it('still flips the task when the progress event fails, and says so in the detail', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    const dir = join(workdir, 'worktrees', 'task-1');
    mkdirSync(dir, { recursive: true });
    const board = new StubBoard();
    board.listTasksResult = [makeTask()];
    board.listRunsResult = [makeRun()];
    board.progressError = new BoardError(
      'http',
      'POST',
      '/api/v1/agent-runs/run-1/progress',
      'progress route rejected the write',
      { status: 400 },
    );

    const orphans = await reconcile(board, makeConfig(workdir));

    expect(orphans[0]).toMatchObject({ taskId: 'task-1', action: 'returned-to-todo' });
    expect(orphans[0]?.detail).toContain('progress event could not be recorded');
    expect(orphans[0]?.detail).toContain('progress route rejected the write');
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'todo', runId: 'run-1' }]);
    expect(existsSync(dir)).toBe(true);
  });

  it('resolves [] without throwing when the workdir inventory itself cannot be read', async () => {
    const workdir = makeTempDir('plandesk-reconcile-');
    // worktrees exists but is a file: the enumeration fails, so there is no
    // provable orphan set — fail closed, start the runner anyway.
    writeFileSync(join(workdir, 'worktrees'), 'not a directory');

    const board = new StubBoard();
    await expect(reconcile(board, makeConfig(workdir))).resolves.toEqual([]);
    expect(board.calls).toEqual([]);
  });

  it('resolves [] when there are no worktrees under the workdir', async () => {
    const board = new StubBoard();
    await expect(reconcile(board, makeConfig(makeTempDir('plandesk-reconcile-')))).resolves.toEqual(
      [],
    );
    // The board-side sweep still runs with no worktrees on disk — that is the
    // case it exists for — but it settles nothing and opens no run.
    expect(board.calls).toEqual(['listTasks']);
    expect(board.statuses).toEqual([]);
  });
});

describe('reconcile — tasks that never reached a worktree', () => {
  it('returns an in_progress task claimed by THIS runner with no worktree to todo', async () => {
    const workdir = makeTempDir('plandesk-reconcile-stranded-');
    const config = makeConfig(workdir);
    const board = new StubBoard();
    board.listTasksBehaviors = [
      [makeTask({ id: 'stranded-1', status: 'in_progress', assignee: config.name })],
    ];

    const orphans = await reconcile(board, config);

    const stranded = orphans.find((orphan) => orphan.taskId === 'stranded-1');
    expect(stranded?.action).toBe('returned-to-todo');
    expect(stranded?.worktreeDir).toBeNull();
    expect(board.statuses).toContainEqual(
      expect.objectContaining({ taskId: 'stranded-1', status: 'todo' }),
    );
  });

  it('never touches an in_progress task claimed by a DIFFERENT runner', async () => {
    const workdir = makeTempDir('plandesk-reconcile-other-');
    const config = makeConfig(workdir);
    const board = new StubBoard();
    board.listTasksBehaviors = [
      [
        makeTask({ id: 'theirs', status: 'in_progress', assignee: 'some-other-runner' }),
        makeTask({ id: 'unclaimed', status: 'in_progress', assignee: null }),
      ],
    ];

    const orphans = await reconcile(board, config);

    // A live runner may be mid-attempt on it; stealing the task is worse than
    // leaving it, so neither a foreign assignee nor an absent one is settled.
    expect(orphans.map((orphan) => orphan.taskId)).not.toContain('theirs');
    expect(orphans.map((orphan) => orphan.taskId)).not.toContain('unclaimed');
    expect(board.statuses).toEqual([]);
  });

  it('does not settle a stranded task twice when the disk scan already covered it', async () => {
    const workdir = makeTempDir('plandesk-reconcile-nodouble-');
    const config = makeConfig(workdir);
    mkdirSync(join(workdir, 'worktrees', 'task-1'), { recursive: true });
    const board = new StubBoard();
    board.listRunsResult = [makeRun()];
    board.listTasksBehaviors = [
      [makeTask({ id: 'task-1', status: 'in_progress', assignee: config.name })],
    ];

    const orphans = await reconcile(board, config);

    expect(orphans.filter((orphan) => orphan.taskId === 'task-1')).toHaveLength(1);
    expect(board.statuses.filter((entry) => entry.taskId === 'task-1')).toHaveLength(1);
  });

  it('does not throw when the board fails during the sweep', async () => {
    const workdir = makeTempDir('plandesk-reconcile-boardfail-');
    const config = makeConfig(workdir);
    const board = new StubBoard();
    board.listTasksBehaviors = [new Error('board unreachable')];

    await expect(reconcile(board, config)).resolves.toBeInstanceOf(Array);
  });
});
