import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunnerConfig } from './config.js';
import type {
  BoardAgentRun,
  BoardClient,
  BoardDocument,
  BoardProject,
  BoardTask,
  ClaimResult,
} from './board.js';
import {
  applyOutcome,
  decideOutcome,
  extractGateCommand,
  needsInputPath,
  renderBrief,
  runGate,
  runLoop,
  runOnce,
} from './loop.js';
import type { SpawnResult } from './spawn.js';
import type { Worktree } from './worktree.js';

// node:fs is mocked (delegating to the real module) so the applyOutcome
// purity test can prove the resolver never touches the filesystem.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync) as typeof actual.existsSync,
    readFileSync: vi.fn(actual.readFileSync) as typeof actual.readFileSync,
    writeFileSync: vi.fn(actual.writeFileSync) as typeof actual.writeFileSync,
  };
});

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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

function makeConfig(workdir: string, overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    boardUrl: 'http://board.example.invalid',
    agentKey: 'sk-test-agent-key',
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
    ...overrides,
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
    description: 'Make the widget frob.\n\ngate: node -e "process.exit(0)"',
    assignee: null,
    ...overrides,
  };
}

function makeSpawnResult(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    exitCode: 0,
    reason: 'exited',
    stdout: '',
    stderr: '',
    truncated: false,
    pid: 4321,
    pgid: 4321,
    durationMs: 12,
    ...overrides,
  };
}

/** A temp directory standing in for a prepared worktree in decideOutcome tests. */
function makeWorktreeStub(): Worktree {
  return {
    dir: makeTempDir('plandesk-loop-wt-'),
    branch: 'task/task-1',
    baseOid: '0123456789abcdef0123456789abcdef01234567',
    repoSlug: 'fixture',
  };
}

// ---------------------------------------------------------------------------
// The stub board. Every method records a token in `calls` (for ordering) and
// its payload (for content); the loop is asserted entirely against this.
// ---------------------------------------------------------------------------

const RUN_ID = 'run-1';

class StubBoard implements BoardClient {
  readonly calls: string[] = [];
  readonly progress: Array<{ runId: string; message: string }> = [];
  readonly statuses: Array<{ taskId: string; status: string; runId: string }> = [];
  readonly completions: Array<{ runId: string; status: string }> = [];
  nextTaskResult: BoardTask | null;
  claimResult: ClaimResult;
  projectResult: BoardProject = { id: 'proj-1', name: 'Fixture', repo_url: null };
  docResult: BoardDocument | null = null;
  projectError: Error | undefined;
  listTasksResult: BoardTask[] = [];
  listRunsResult: BoardAgentRun[] = [];

  constructor(task: BoardTask | null, options: { claim?: ClaimResult } = {}) {
    this.nextTaskResult = task;
    this.claimResult = options.claim ?? {
      claimed: true,
      task: task === null ? makeTask() : { ...task, status: 'in_progress' },
    };
  }

  nextTask(): Promise<BoardTask | null> {
    this.calls.push('nextTask');
    return Promise.resolve(this.nextTaskResult);
  }

  claimTask(taskId: string, agentRef: string): Promise<ClaimResult> {
    this.calls.push(`claimTask:${taskId}:${agentRef}`);
    return Promise.resolve(this.claimResult);
  }

  setTaskStatus(taskId: string, status: string, runId: string): Promise<void> {
    this.calls.push(`setTaskStatus:${status}`);
    this.statuses.push({ taskId, status, runId });
    return Promise.resolve();
  }

  project(): Promise<BoardProject> {
    this.calls.push('project');
    if (this.projectError !== undefined) {
      return Promise.reject(this.projectError);
    }
    return Promise.resolve(this.projectResult);
  }

  startRun(label?: string): Promise<{
    id: string;
    project_id: string;
    status: string;
    label: string | null;
    started_at: string;
    completed_at: string | null;
  }> {
    this.calls.push('startRun');
    return Promise.resolve({
      id: RUN_ID,
      project_id: 'proj-1',
      status: 'running',
      label: label ?? null,
      started_at: new Date().toISOString(),
      completed_at: null,
    });
  }

  recordProgress(runId: string, message: string): Promise<void> {
    this.calls.push('recordProgress');
    this.progress.push({ runId, message });
    return Promise.resolve();
  }

  completeRun(runId: string, status: 'completed' | 'failed'): Promise<void> {
    this.calls.push(`completeRun:${status}`);
    this.completions.push({ runId, status });
    return Promise.resolve();
  }

  taskDocument(taskId: string): Promise<BoardDocument | null> {
    this.calls.push(`taskDocument:${taskId}`);
    return Promise.resolve(this.docResult);
  }

  listTasks(): Promise<BoardTask[]> {
    this.calls.push('listTasks');
    return Promise.resolve(this.listTasksResult);
  }

  listRuns(): Promise<BoardAgentRun[]> {
    this.calls.push('listRuns');
    return Promise.resolve(this.listRunsResult);
  }
}

// ---------------------------------------------------------------------------
// A real git fixture: bare remote + seed clone carrying worker declarations
// and worker scripts, exactly what resolveWorkers and runHeadless need.
// ---------------------------------------------------------------------------

const COMMIT_ARGS = ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t'];

function gitRun(cwd: string | undefined, args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function workerFile(headless: string): string {
  return ['---', 'type: worker', 'probe: "true"', `headless: ${headless}`, '---', ''].join('\n');
}

interface LoopFixture {
  config: RunnerConfig;
  workdir: string;
  remoteUrl: string;
}

function makeLoopFixture(configOverrides: Partial<RunnerConfig> = {}): LoopFixture {
  const root = makeTempDir('plandesk-loop-');
  const workdir = join(root, 'work');
  mkdirSync(workdir, { recursive: true });
  const config = makeConfig(workdir, { defaultWorker: 'ok-worker', ...configOverrides });

  const remoteUrl = join(root, 'remote.git');
  gitRun(undefined, ['init', '--bare', '-b', 'main', remoteUrl]);

  const seedDir = join(root, 'seed');
  gitRun(undefined, ['init', '-b', 'main', seedDir]);
  writeFileSync(join(seedDir, '.gitignore'), 'node_modules/\n');

  const workersDir = join(seedDir, '.agents', 'factory', 'workers');
  mkdirSync(workersDir, { recursive: true });
  writeFileSync(join(workersDir, 'ok-worker.md'), workerFile('node worker-ok.js'));
  writeFileSync(join(workersDir, 'asks-worker.md'), workerFile('node worker-asks.js'));
  writeFileSync(join(workersDir, 'fails-worker.md'), workerFile('node worker-fails.js'));
  writeFileSync(join(workersDir, 'sleeps-worker.md'), workerFile('node worker-sleeps.js'));

  writeFileSync(join(seedDir, 'worker-ok.js'), 'process.exit(0);\n');
  writeFileSync(
    join(seedDir, 'worker-asks.js'),
    [
      "const fs = require('node:fs');",
      "fs.mkdirSync('.plandesk', { recursive: true });",
      "fs.writeFileSync('.plandesk/NEEDS_INPUT.md', 'Which database should the migration target?');",
      '',
    ].join('\n'),
  );
  writeFileSync(join(seedDir, 'worker-fails.js'), 'process.exit(3);\n');
  writeFileSync(join(seedDir, 'worker-sleeps.js'), 'setTimeout(() => process.exit(0), 120);\n');

  gitRun(seedDir, [...COMMIT_ARGS, 'add', '.']);
  gitRun(seedDir, [...COMMIT_ARGS, 'commit', '-m', 'init']);
  gitRun(seedDir, ['remote', 'add', 'origin', remoteUrl]);
  gitRun(seedDir, ['push', '-q', '-u', 'origin', 'main']);

  return { config, workdir, remoteUrl };
}

describe('extractGateCommand', () => {
  it('finds a ```gate fenced block', () => {
    const description = 'Do it.\n\n```gate\npnpm test\n```\n';
    expect(extractGateCommand(description)).toBe('pnpm test');
  });

  it('takes the first non-empty line of a multi-line gate block (a gate is one command)', () => {
    const description = '```gate\n\npnpm --filter x test\nthen more\n```';
    expect(extractGateCommand(description)).toBe('pnpm --filter x test');
  });

  it('finds a marked line: gate: or validation:, with optional bullet/heading marker', () => {
    expect(extractGateCommand('validation: pnpm build')).toBe('pnpm build');
    expect(extractGateCommand('- gate: make check')).toBe('make check');
    expect(extractGateCommand('## Gate: rake spec')).toBe('rake spec');
    expect(extractGateCommand('GATE:   pnpm lint  ')).toBe('pnpm lint');
  });

  it('returns undefined for descriptions with no declared gate — never guesses', () => {
    expect(extractGateCommand('Run the tests somehow.')).toBeUndefined();
    expect(extractGateCommand('```bash\npnpm test\n```')).toBeUndefined();
    expect(extractGateCommand('gate:')).toBeUndefined();
    expect(extractGateCommand('')).toBeUndefined();
    expect(extractGateCommand(null)).toBeUndefined();
    expect(extractGateCommand(undefined)).toBeUndefined();
  });
});

describe('renderBrief', () => {
  const doc: BoardDocument = {
    id: 'doc-1',
    project_id: 'proj-1',
    title: 'Widget spec',
    body: 'The widget must frob synchronously.',
    status_line: 'Draft',
  };

  it('contains the task label, the gate command, and the linked document body', () => {
    const brief = renderBrief(makeTask(), doc);
    expect(brief).toContain('Frobnicate the widget');
    expect(brief).toContain('node -e "process.exit(0)"');
    expect(brief).toContain('The widget must frob synchronously.');
    expect(brief).toContain('NEEDS_INPUT.md');
  });

  it('contains neither the board URL nor the agent key — it composes task and document only', () => {
    // renderBrief never sees the config, so it cannot inject the credential:
    // asserted with clean task content (scrubbing secrets planted in task
    // text is not its job — it faithfully renders the task's own contract).
    const brief = renderBrief(makeTask(), doc);

    expect(brief).not.toContain('http://board.example.invalid');
    expect(brief).not.toContain('sk-test-agent-key');
  });

  it('says plainly when the task declares no gate', () => {
    const brief = renderBrief(makeTask({ description: 'Just do it.' }));
    expect(brief).toContain('declares no validation command');
  });
});

describe('runGate', () => {
  it('runs the declared command in the worktree and reports exit 0', async () => {
    const wt = makeWorktreeStub();
    const config = makeConfig(wt.dir);
    const task = makeTask({ description: 'gate: node -e "process.exit(0)"' });

    await expect(runGate(task, wt, config)).resolves.toMatchObject({ exitCode: 0 });
  }, 20_000);

  it('captures gate output and a non-zero exit code', async () => {
    const wt = makeWorktreeStub();
    const config = makeConfig(wt.dir);
    const task = makeTask({
      description: 'gate: node -e "console.log(\'gate says no\'); process.exit(1)"',
    });

    const result = await runGate(task, wt, config);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('gate says no');
  }, 20_000);

  it('resolves failed with a note when the task declares no gate — never assumes success', async () => {
    const wt = makeWorktreeStub();
    const config = makeConfig(wt.dir);
    const task = makeTask({ description: 'No gate here.' });

    const result = await runGate(task, wt, config);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('declares no validation gate');
  }, 20_000);
});

describe('decideOutcome', () => {
  it('NEEDS_INPUT.md beats a zero exit — needs_input, and the gate never runs', async () => {
    const wt = makeWorktreeStub();
    mkdirSync(join(wt.dir, '.plandesk'), { recursive: true });
    writeFileSync(needsInputPath(wt.dir), 'Which database?');
    const gate = vi.fn(() => Promise.resolve({ exitCode: 0 }));

    await expect(decideOutcome(wt, makeSpawnResult({ exitCode: 0 }), gate)).resolves.toBe(
      'needs_input',
    );
    expect(gate).not.toHaveBeenCalled();
  });

  it('a non-zero agent exit fails and skips the gate entirely', async () => {
    const wt = makeWorktreeStub();
    const gate = vi.fn(() => Promise.resolve({ exitCode: 0 }));

    await expect(decideOutcome(wt, makeSpawnResult({ exitCode: 2 }), gate)).resolves.toBe('failed');
    expect(gate).not.toHaveBeenCalled();
  });

  it('a timeout or cancellation is a failure (success is exited && exit 0, nothing else)', async () => {
    const wt = makeWorktreeStub();
    const gate = vi.fn(() => Promise.resolve({ exitCode: 0 }));

    await expect(
      decideOutcome(wt, makeSpawnResult({ exitCode: null, reason: 'timeout' }), gate),
    ).resolves.toBe('failed');
    await expect(
      decideOutcome(wt, makeSpawnResult({ exitCode: null, reason: 'cancelled' }), gate),
    ).resolves.toBe('failed');
    await expect(
      decideOutcome(wt, makeSpawnResult({ exitCode: null, reason: 'spawn-error' }), gate),
    ).resolves.toBe('failed');
    expect(gate).not.toHaveBeenCalled();
  });

  it('a zero agent exit defers to the gate: exit 0 → done, anything else → failed', async () => {
    const wt = makeWorktreeStub();
    await expect(
      decideOutcome(
        wt,
        makeSpawnResult(),
        vi.fn(() => Promise.resolve({ exitCode: 0 })),
      ),
    ).resolves.toBe('done');
    await expect(
      decideOutcome(
        wt,
        makeSpawnResult(),
        vi.fn(() => Promise.resolve({ exitCode: 1 })),
      ),
    ).resolves.toBe('failed');
  });
});

describe('applyOutcome (pure and total)', () => {
  function allRows(): Array<[BoardTask, ReturnType<typeof applyOutcome>]> {
    const auto = makeTask({ lane: 'auto' });
    const approve = makeTask({ lane: 'approve' });
    const full = makeTask({ lane: 'full' });
    const unlaned = makeTask({ lane: null });
    return [
      [auto, applyOutcome(auto, 'done')],
      [approve, applyOutcome(approve, 'done')],
      [full, applyOutcome(full, 'done')],
      [unlaned, applyOutcome(unlaned, 'done')],
      [auto, applyOutcome(auto, 'failed')],
      [unlaned, applyOutcome(unlaned, 'needs_input')],
    ];
  }

  it('done + auto → set-status done', () => {
    const task = makeTask({ lane: 'auto' });
    expect(applyOutcome(task, 'done')).toMatchObject({
      kind: 'set-status',
      status: 'done',
    });
    if (applyOutcome(task, 'done').kind === 'set-status') {
      expect(applyOutcome(task, 'done').note).toContain('gate passed');
    }
  });

  it('done + approve → leave-in-progress awaiting a human gate', () => {
    const mutation = applyOutcome(makeTask({ lane: 'approve' }), 'done');
    expect(mutation.kind).toBe('leave-in-progress');
    expect(mutation.note).toContain('awaits a human gate');
  });

  it('done + full → leave-in-progress awaiting a human gate', () => {
    const mutation = applyOutcome(makeTask({ lane: 'full' }), 'done');
    expect(mutation.kind).toBe('leave-in-progress');
    expect(mutation.note).toContain('awaits a human gate');
  });

  it('done with no lane recorded is treated as approve, never auto (fail closed)', () => {
    const mutation = applyOutcome(makeTask({ lane: null }), 'done');
    expect(mutation.kind).toBe('leave-in-progress');
  });

  it('failed → set-status todo with the gate note', () => {
    const failed = applyOutcome(makeTask(), 'failed');
    expect(failed).toMatchObject({ kind: 'set-status', status: 'todo' });
    if (failed.kind === 'set-status') {
      expect(failed.note).toContain('gate output');
    }
  });

  it('needs_input → set-status scope (the contract is incomplete)', () => {
    const parked = applyOutcome(makeTask(), 'needs_input');
    expect(parked).toMatchObject({ kind: 'set-status', status: 'scope' });
    if (parked.kind === 'set-status') {
      expect(parked.note).toContain('question');
    }
  });

  it('performs no I/O and is deterministic across every row', () => {
    vi.mocked(fs.existsSync).mockClear();
    vi.mocked(fs.readFileSync).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();

    const first = allRows();
    const second = allRows();

    expect(second).toEqual(first);
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('runOnce', () => {
  it('returns idle without starting a run when no task is available', async () => {
    const workdir = makeTempDir('plandesk-runonce-');
    const board = new StubBoard(null);

    await expect(runOnce(makeConfig(workdir), board)).resolves.toBe('idle');

    expect(board.calls).toEqual(['nextTask']);
    expect(board.completions).toEqual([]);
    expect(existsSync(join(workdir, 'repos'))).toBe(false);
  });

  it('returns lost-race without starting a run or touching git when the claim is lost', async () => {
    const workdir = makeTempDir('plandesk-runonce-');
    const board = new StubBoard(makeTask(), { claim: { claimed: false } });

    await expect(runOnce(makeConfig(workdir), board)).resolves.toBe('lost-race');

    expect(board.calls).toEqual(['nextTask', 'claimTask:task-1:test-runner']);
    expect(board.completions).toEqual([]);
    expect(existsSync(join(workdir, 'repos'))).toBe(false);
    expect(existsSync(join(workdir, 'worktrees'))).toBe(false);
  });

  it('settles failed with a note when the task declares no gate — no git, no worker', async () => {
    const workdir = makeTempDir('plandesk-runonce-');
    const board = new StubBoard(makeTask({ description: 'Do the thing with no gate.' }));

    const result = await runOnce(makeConfig(workdir), board);

    expect(result).toBe('failed');
    expect(board.calls).toEqual([
      'nextTask',
      'claimTask:task-1:test-runner',
      'startRun',
      'recordProgress',
      'setTaskStatus:todo',
      'completeRun:failed',
    ]);
    expect(board.progress[0]?.message).toContain('declares no validation gate');
    expect(board.statuses[0]).toEqual({ taskId: 'task-1', status: 'todo', runId: RUN_ID });
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'failed' }]);
    expect(existsSync(join(workdir, 'repos'))).toBe(false);
    expect(board.calls).not.toContain('project');
    expect(board.calls.some((call) => call.startsWith('taskDocument'))).toBe(false);
  });

  it('runs the whole cycle for a done auto-lane task: gate decides, task closed, run completed', async () => {
    const fixture = makeLoopFixture();
    const board = new StubBoard(makeTask());
    board.projectResult = { id: 'proj-1', name: 'Fixture', repo_url: fixture.remoteUrl };
    board.docResult = {
      id: 'doc-1',
      project_id: 'proj-1',
      title: 'Spec',
      body: 'Frob it.',
      status_line: 'Draft',
    };

    const result = await runOnce(fixture.config, board);

    expect(result).toBe('done');
    expect(board.calls).toEqual([
      'nextTask',
      'claimTask:task-1:test-runner',
      'startRun',
      'project',
      'taskDocument:task-1',
      'recordProgress',
      'setTaskStatus:done',
      'completeRun:completed',
    ]);
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'done', runId: RUN_ID }]);
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'completed' }]);
    expect(board.progress).toHaveLength(1);
    expect(board.progress[0]?.message).toContain('gate passed');
    // done + clean + nothing new to push → the worktree is removed
    expect(existsSync(join(fixture.workdir, 'worktrees', 'task-1'))).toBe(false);
  }, 60_000);

  it('leaves a done approve-lane task in progress for a human gate', async () => {
    const fixture = makeLoopFixture();
    const board = new StubBoard(makeTask({ lane: 'approve' }));
    board.projectResult = { id: 'proj-1', name: 'Fixture', repo_url: fixture.remoteUrl };

    const result = await runOnce(fixture.config, board);

    expect(result).toBe('done');
    expect(board.statuses).toEqual([]);
    expect(board.progress[0]?.message).toContain('awaits a human gate');
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'completed' }]);
  }, 60_000);

  it('parks needs_input to scope with the question, and retains the worktree', async () => {
    const fixture = makeLoopFixture({ defaultWorker: 'asks-worker' });
    const board = new StubBoard(makeTask());
    board.projectResult = { id: 'proj-1', name: 'Fixture', repo_url: fixture.remoteUrl };

    const result = await runOnce(fixture.config, board);

    expect(result).toBe('needs_input');
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'scope', runId: RUN_ID }]);
    expect(board.progress.at(-1)?.message).toContain('Which database should the migration target?');
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'completed' }]);
    expect(existsSync(join(fixture.workdir, 'worktrees', 'task-1'))).toBe(true);
  }, 60_000);

  it('fails without running the gate when the worker exits non-zero, and parks todo', async () => {
    const fixture = makeLoopFixture({ defaultWorker: 'fails-worker' });
    const board = new StubBoard(makeTask());
    board.projectResult = { id: 'proj-1', name: 'Fixture', repo_url: fixture.remoteUrl };

    const result = await runOnce(fixture.config, board);

    expect(result).toBe('failed');
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'todo', runId: RUN_ID }]);
    expect(board.progress.at(-1)?.message).toContain('gate not run');
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'failed' }]);
    expect(existsSync(join(fixture.workdir, 'worktrees', 'task-1'))).toBe(true);
  }, 60_000);

  it('fails when the gate itself exits non-zero, even after a clean worker exit', async () => {
    const fixture = makeLoopFixture();
    const board = new StubBoard(
      makeTask({ description: 'Make it so.\n\ngate: node -e "process.exit(1)"' }),
    );
    board.projectResult = { id: 'proj-1', name: 'Fixture', repo_url: fixture.remoteUrl };

    const result = await runOnce(fixture.config, board);

    expect(result).toBe('failed');
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'todo', runId: RUN_ID }]);
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'failed' }]);
  }, 60_000);

  it('heartbeats while the worker runs and leaves no timer behind when it resolves', async () => {
    const fixture = makeLoopFixture({ defaultWorker: 'sleeps-worker', heartbeatMs: 5 });
    const board = new StubBoard(makeTask());
    board.projectResult = { id: 'proj-1', name: 'Fixture', repo_url: fixture.remoteUrl };

    const timeoutCount = (): number =>
      process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
    const before = timeoutCount();

    const result = await runOnce(fixture.config, board);

    expect(result).toBe('done');
    const heartbeats = board.progress.filter((entry) => entry.message.startsWith('heartbeat:'));
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    expect(board.progress.at(-1)?.message).toContain('gate passed');

    // The heartbeat timer must be gone when the spawn resolves: wait past a
    // few heartbeat intervals and prove no further beats arrive, and check no
    // Timeout handle remains beyond the ambient baseline.
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    const after = board.progress.filter((entry) => entry.message.startsWith('heartbeat:'));
    expect(after).toHaveLength(heartbeats.length);
    expect(
      process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length,
    ).toBeLessThanOrEqual(before);
  }, 60_000);

  it('settles the run failed and rethrows when infrastructure fails mid-attempt, leaving the task claimed', async () => {
    const workdir = makeTempDir('plandesk-runonce-');
    const board = new StubBoard(makeTask());
    board.projectError = new Error('board is down');

    await expect(runOnce(makeConfig(workdir), board)).rejects.toThrow('board is down');

    expect(board.progress[0]?.message).toContain('attempt aborted by runner error');
    expect(board.completions).toEqual([{ runId: RUN_ID, status: 'failed' }]);
    expect(board.statuses).toEqual([]);
  });
});

describe('runLoop', () => {
  it('reconciles an orphaned attempt before the first poll — settle, then claim', async () => {
    const workdir = makeTempDir('plandesk-loop-startup-');
    const orphanDir = join(workdir, 'worktrees', 'task-1');
    mkdirSync(orphanDir, { recursive: true });
    const board = new StubBoard(null); // the loop itself stays idle
    board.listTasksResult = [makeTask({ status: 'in_progress' })];
    board.listRunsResult = [
      {
        id: 'run-9',
        project_id: 'proj-1',
        status: 'running',
        label: 'task task-1: Frobnicate the widget',
        started_at: new Date().toISOString(),
        completed_at: null,
      },
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const controller = new AbortController();
    const stop = setTimeout(() => {
      controller.abort();
    }, 25);

    await runLoop(makeConfig(workdir, { pollMs: 5 }), board, controller.signal);
    clearTimeout(stop);

    // Call-order proof, not a source read: every reconcile write happened
    // before the loop's first poll.
    const firstPoll = board.calls.indexOf('nextTask');
    expect(firstPoll).toBeGreaterThan(0);
    expect(board.calls[0]).toBe('listTasks');
    expect(board.calls.indexOf('recordProgress')).toBeLessThan(firstPoll);
    expect(board.calls.indexOf('setTaskStatus:todo')).toBeLessThan(firstPoll);
    expect(board.statuses).toEqual([{ taskId: 'task-1', status: 'todo', runId: 'run-9' }]);
    // The orphan is reported to the operator and the worktree is retained.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('reconcile'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('task-1'));
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('polls until the signal aborts, sleeping pollMs between passes', async () => {
    const board = new StubBoard(null);
    const config = makeConfig(makeTempDir('plandesk-loop-poll-'), { pollMs: 5 });
    const controller = new AbortController();
    const stop = setTimeout(() => {
      controller.abort();
    }, 25);

    await runLoop(config, board, controller.signal);
    clearTimeout(stop);

    expect(board.calls.length).toBeGreaterThanOrEqual(2);
    // Startup reconciliation reads the board once for stranded tasks; every
    // call after that belongs to the poll.
    expect(board.calls.filter((call) => call !== 'listTasks').every((c) => c === 'nextTask')).toBe(
      true,
    );
  });

  it('returns immediately when the signal is already aborted', async () => {
    const board = new StubBoard(null);
    const controller = new AbortController();
    controller.abort();

    await runLoop(makeConfig(makeTempDir('plandesk-loop-poll-')), board, controller.signal);

    expect(board.calls).toEqual([]);
  });
});
