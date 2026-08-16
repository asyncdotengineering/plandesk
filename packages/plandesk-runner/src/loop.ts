import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RunnerConfig } from './config.js';
import type { BoardClient, BoardDocument, BoardTask } from './board.js';
import { buildEnv, readBoundedFile, runHeadless, spawn, substitutePlaceholders } from './spawn.js';
import type { SpawnResult } from './spawn.js';
import { pickWorker, resolveWorkers, type Worker } from './workers.js';
import { retainOrRemove, ensureRepo, prepareWorktree, resolveBaseCommit, type Worktree } from './worktree.js';
import { reconcile } from './reconcile.js';

/**
 * The poll-claim-dispatch-settle cycle — the slice that joins config, board,
 * workers, worktree and spawn into one loop.
 *
 * Two rules ported from the systems this runner is modeled on, and preserved
 * here verbatim:
 *
 * 1. **The outcome comes from an exit code, never from the agent's opinion.**
 *    github.com/owainlewis/factory `internal/worker/attempt_lifecycle.go`
 *    (`terminalState`) decides success as `Reason == "exited" && ExitCode ==
 *    0` and stores the agent's final message as text for a human, never as a
 *    decision input. {@link decideOutcome} is that function: worker output
 *    and gate output become note text on the run, nothing more.
 * 2. **The status resolver is pure.** The agent judges; code routes. Astro's
 *    triagebot-action `src/handlers/triage.ts` (`resolveTriageLabel`) is a
 *    pure function from a structured result to the next state, exhaustively
 *    testable without GitHub. {@link applyOutcome} is the same shape: a pure
 *    total function from (task, outcome) to the board mutation — and
 *    `src/router.ts` there keeps routing out of the model's path just as
 *    `renderBrief`/`applyOutcome` here never touch the network.
 */

/** Terminal verdict of one attempt. */
export type Outcome = 'done' | 'failed' | 'needs_input';

/**
 * The board write an outcome resolves to. `set-status` carries a task status;
 * `leave-in-progress` carries none (the task stays claimed). The `note` is
 * the human-readable summary — it is recorded as the run's one summary
 * progress event, because the board's `PATCH /tasks/:id` has no note field.
 */
export type BoardMutation =
  | { kind: 'set-status'; status: 'done' | 'todo' | 'scope'; note: string }
  | { kind: 'leave-in-progress'; note: string };

/** Where a dispatched worker writes its question for a human. */
export function needsInputPath(worktreeDir: string): string {
  return join(worktreeDir, '.plandesk', 'NEEDS_INPUT.md');
}

/** Cap on the NEEDS_INPUT.md content folded into a progress note. */
const MAX_NOTE_BYTES = 16 * 1024;

/**
 * Locate the validation command in a task description, or return undefined
 * when the task declares none.
 *
 * v1 recognition, first match wins scanning top to bottom:
 *
 * 1. A fenced code block whose info string is exactly `gate`:
 *
 *        ```gate
 *        pnpm --filter @plandesk/runner test
 *        ```
 *
 *    The gate is one command — one line — because {@link runGate} execs it
 *    as argv (a multi-line script cannot be argv), so the first non-empty
 *    line of the block is the command and any further lines are ignored.
 *
 * 2. A line the description marks as the validation command: an optional
 *    leading `#`, `>`, `*`, or `-` marker, then `gate:` or `validation:`
 *    (case-insensitive), then the command to end of line:
 *
 *        gate: pnpm --filter @plandesk/runner test
 *
 * Absent means absent: the runner never assumes success for a task without a
 * gate (see {@link runGate} and {@link runOnce}).
 */
export function extractGateCommand(description: string | null | undefined): string | undefined {
  if (description === undefined || description === null) {
    return undefined;
  }
  const lines = description.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const fence = /^\s*```+\s*gate\s*$/i.exec(line);
    if (fence !== null) {
      for (let body = index + 1; body < lines.length; body += 1) {
        const candidate = lines[body];
        if (candidate === undefined) {
          break;
        }
        if (/^\s*```/.test(candidate)) {
          break; // an empty gate block is no gate
        }
        const command = candidate.trim();
        if (command.length > 0) {
          return command;
        }
      }
      continue;
    }
    const marked = /^\s*(?:[#>*-]+\s*)?(?:gate|validation)\s*:\s*(.+)$/i.exec(line);
    if (marked !== null) {
      const command = (marked[1] ?? '').trim();
      if (command.length > 0) {
        return command;
      }
    }
  }
  return undefined;
}

/**
 * Render the brief a dispatched worker receives as its entire world (the
 * factory `brief-template.md` shape, reduced to what the runner knows): the
 * task identity and contract, the gate that will judge it, the linked
 * document when one exists, and the NEEDS_INPUT contract. Pure — and it
 * never sees the board URL or the agent key, so it cannot leak them.
 */
export function renderBrief(task: BoardTask, doc?: BoardDocument): string {
  const lane = task.lane ?? '(none recorded — treated as approve)';
  const gate = extractGateCommand(task.description);
  const lines: string[] = [
    `# Plan Desk task ${task.id}: ${task.label}`,
    '',
    `Status: ${task.status}; lane: ${lane}. You are working in a worktree on a task branch.`,
    '',
    '## The contract',
    '',
    task.description?.trim() || '(the task carries no description)',
    '',
    '## The gate — the only judge of done',
    '',
  ];
  if (gate === undefined) {
    lines.push(
      'This task declares no validation command. Say so and stop: the runner',
      'marks any attempt without a gate failed, never done.',
    );
  } else {
    lines.push(
      'When you believe you are finished, this command must exit 0. The runner',
      'records its exit code and decides the outcome from it alone — your own',
      'summary never decides the attempt:',
      '',
      '    ' + gate,
    );
  }
  if (doc !== undefined) {
    lines.push(
      '',
      `## Linked document: ${doc.title}`,
      '',
      doc.body.trim() || '(the linked document is empty)',
    );
  }
  lines.push(
    '',
    '## When you cannot proceed',
    '',
    'If you need a human decision or missing input, write your question to',
    '`.plandesk/NEEDS_INPUT.md` at the worktree root and stop. The runner parks',
    'the task for a human. Anything else — including a clean exit that did not',
    'pass the gate — is a failed attempt.',
  );
  return lines.join('\n');
}

/**
 * Run the task's validation gate in the worktree: the command from
 * {@link extractGateCommand}, execed as argv (via `substitutePlaceholders`
 * word-splitting, with `{repo_path}` substituted should a gate want it) in
 * the worktree with `buildEnv()` — the same constructed environment the
 * worker got. A task that declares no gate resolves exit code 1 with a note
 * saying so: the runner never assumes success. Output is the captured
 * stdout+stderr for the run's note, not a decision input.
 */
export async function runGate(
  task: BoardTask,
  wt: Worktree,
  config: RunnerConfig,
): Promise<{ exitCode: number; output: string }> {
  const command = extractGateCommand(task.description);
  if (command === undefined) {
    return {
      exitCode: 1,
      output: `task ${task.id} declares no validation gate — refusing to assume success`,
    };
  }
  const res = await spawn({
    cmd: substitutePlaceholders(command, { repoPath: wt.dir }),
    cwd: wt.dir,
    env: buildEnv(),
    timeoutMs: config.attemptTimeoutMs,
  });
  const captured = [res.stdout, res.stderr].filter((part) => part.trim().length > 0).join('\n');
  const prefix =
    res.reason === 'exited' ? '' : `gate ${res.reason} (exit code ${String(res.exitCode)})\n`;
  return { exitCode: res.exitCode ?? 1, output: `${prefix}${captured}` };
}

/**
 * Decide the outcome of an attempt, in this exact order (factory
 * `terminalState`: success is `reason === 'exited' && exitCode === 0`, and
 * nothing else — a timeout, a cancellation, or a spawn error is a failure):
 *
 * 1. `NEEDS_INPUT.md` present at `<worktree>/.plandesk/NEEDS_INPUT.md` →
 *    `needs_input`. This beats a zero exit: a worker that finished its shift
 *    and left a question still needs a human.
 * 2. Agent exit ≠ 0 → `failed`. The gate is **not run** — there is nothing
 *    to verify.
 * 3. Gate exit 0 → `done`; anything else → `failed`.
 *
 * `gate` is a thunk so the decision order is enforced in one place: the
 * gate runs only at step 3, never before.
 */
export async function decideOutcome(
  wt: Worktree,
  res: SpawnResult,
  gate: () => Promise<{ exitCode: number }>,
): Promise<Outcome> {
  if (existsSync(needsInputPath(wt.dir))) {
    return 'needs_input';
  }
  if (!(res.reason === 'exited' && res.exitCode === 0)) {
    return 'failed';
  }
  const gateResult = await gate();
  return gateResult.exitCode === 0 ? 'done' : 'failed';
}

/**
 * Map an outcome to the board write it resolves to — pure and total: a
 * function of (task, outcome) only, no I/O, exhaustively testable without a
 * board (triagebot's `resolveTriageLabel` shape).
 *
 * - `done` on lane `auto` closes the task: `auto` means "isolated,
 *   low-blast-radius … no human" (.agents/factory/lanes.md).
 * - `done` on `approve` or `full` stays in progress — those lanes require a
 *   human gate-resolver, so the runner leaves the task claimed and says so.
 *   A task with **no lane recorded is treated as `approve`, never `auto`**
 *   (lanes.md) — fail closed.
 * - `failed` parks back to `todo` for a retry with fresh context; the gate
 *   output rides the run's summary event.
 * - `needs_input` parks as `scope`. There is no `awaiting_human` status in
 *   v1, and `scope` already means exactly this — "the contract is
 *   incomplete": the worker's question is the missing piece of the task's
 *   contract, so the task goes back to scoping, with the question recorded
 *   on the run.
 */
export function applyOutcome(task: BoardTask, outcome: Outcome): BoardMutation {
  switch (outcome) {
    case 'done':
      if (task.lane === 'auto') {
        return {
          kind: 'set-status',
          status: 'done',
          note: 'gate passed (exit 0) — lane auto, task closed by the runner',
        };
      }
      return {
        kind: 'leave-in-progress',
        note: `gate passed (exit 0) — lane ${task.lane ?? '(none recorded, treated as approve)'} awaits a human gate before this task is done`,
      };
    case 'failed':
      return {
        kind: 'set-status',
        status: 'todo',
        note: 'attempt failed — parked back to todo; gate output recorded on the agent run',
      };
    case 'needs_input':
      return {
        kind: 'set-status',
        status: 'scope',
        note: 'worker requested input — parked to scope; the question is recorded on the agent run and in the retained worktree under .plandesk/NEEDS_INPUT.md',
      };
  }
}

/** Evidence an attempt leaves behind, folded into the run's summary event. */
interface AttemptEvidence {
  outcome: Outcome;
  /** The mutation's note, from applyOutcome. */
  note: string;
  /** Gate output, worker stderr, or the NEEDS_INPUT question — for a human. */
  detail: string;
}

/** Read (bounded) the worker's question from the worktree, if it left one. */
function readNeedsInput(worktreeDir: string): string | undefined {
  const bounded = readBoundedFile(needsInputPath(worktreeDir), MAX_NOTE_BYTES);
  if (bounded === undefined || bounded.text.trim().length === 0) {
    return undefined;
  }
  return bounded.text.trim();
}

/**
 * One full cycle: next-task → claim → start run → (gate check → repo →
 * worktree → workers → dispatch → decide) → record progress → apply outcome
 * → retain-or-remove → complete run.
 *
 * Resolves `'idle'` when the board has no actionable task (no run started),
 * `'lost-race'` when the claim was lost (no run started, git untouched), or
 * the attempt's {@link Outcome}. `signal` aborts the worker mid-flight: the
 * spawn resolves `cancelled`, which decides `failed`, and the attempt still
 * settles — no dangling run.
 *
 * A task whose description declares no gate is settled `failed` before any
 * git or dispatch: without a gate the attempt can never be `done`, so
 * running a worker would only burn one. A project with no `repo_url` is the
 * same shape of broken contract and settles the same way.
 *
 * Infrastructure errors (git failures, no usable workers, board failures
 * mid-attempt) rethrow after best-effort failing the run — loudly, leaving
 * the task claimed for a human, rather than parking it `todo` where the
 * next poll would redispatch into the same error.
 */
export async function runOnce(
  config: RunnerConfig,
  board: BoardClient,
  signal?: AbortSignal,
): Promise<'idle' | 'lost-race' | Outcome> {
  const nextTask = await board.nextTask();
  if (nextTask === null) {
    return 'idle';
  }

  const claim = await board.claimTask(nextTask.id, config.name);
  if (!claim.claimed) {
    return 'lost-race';
  }
  const task = claim.task;

  const run = await board.startRun(`task ${task.id}: ${task.label}`);

  let repoDir: string | undefined;
  let wt: Worktree | undefined;
  let evidence: AttemptEvidence;
  try {
    const gateCommand = extractGateCommand(task.description);
    if (gateCommand === undefined) {
      // Broken contract — settle failed without touching git or a worker.
      evidence = {
        outcome: 'failed',
        note: applyOutcome(task, 'failed').note,
        detail:
          'task declares no validation gate — add a ```gate fenced block or a `gate:` line to the task description',
      };
    } else {
      const project = await board.project();
      if (project.repo_url === null) {
        evidence = {
          outcome: 'failed',
          note: applyOutcome(task, 'failed').note,
          detail: `project ${project.id} declares no repo_url — the runner cannot prepare a worktree`,
        };
      } else {
        const attempt = await executeAttempt(board, config, task, run.id, project.repo_url, signal);
        repoDir = attempt.repoDir;
        wt = attempt.wt;
        evidence = attempt.evidence;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await board
      .recordProgress(run.id, `attempt aborted by runner error: ${message}`)
      .catch(() => undefined);
    await board.completeRun(run.id, 'failed').catch(() => undefined);
    throw error;
  }

  const mutation = applyOutcome(task, evidence.outcome);
  const detail = evidence.detail.trim();
  await board.recordProgress(run.id, detail.length > 0 ? `${mutation.note}\n\n${detail}` : mutation.note);
  if (mutation.kind === 'set-status') {
    await board.setTaskStatus(task.id, mutation.status, run.id);
  }
  if (repoDir !== undefined && wt !== undefined) {
    await retainOrRemove(repoDir, wt, evidence.outcome);
  }
  await board.completeRun(run.id, evidence.outcome === 'failed' ? 'failed' : 'completed');
  return evidence.outcome;
}

/** The worker-visible failure when the gate never ran (agent exit ≠ 0). */
function workerFailureDetail(res: SpawnResult): string {
  const captured = [res.stdout, res.stderr].filter((part) => part.trim().length > 0).join('\n');
  return `worker ${res.reason} (exit code ${String(res.exitCode)}) — gate not run\n${captured}`;
}

/**
 * The dispatched middle of one attempt: repo → worktree → workers → brief →
 * spawn (heartbeat alongside) → decide. Returns the worktree handles the
 * settle phase needs plus the evidence for the run's summary event.
 */
async function executeAttempt(
  board: BoardClient,
  config: RunnerConfig,
  task: BoardTask,
  runId: string,
  repoUrl: string,
  signal: AbortSignal | undefined,
): Promise<{ repoDir: string; wt: Worktree; evidence: AttemptEvidence }> {
  const repoDir = await ensureRepo(repoUrl, config);
  const baseOid = await resolveBaseCommit(repoDir);
  const wt = await prepareWorktree(repoDir, task.id, baseOid, config);

  const { usable } = await resolveWorkers(wt.dir, config);
  const worker = pickWorker(usable, config);
  const doc = await board.taskDocument(task.id);
  const brief = renderBrief(task, doc ?? undefined);

  let gateOutput: string | undefined;
  const res = await dispatchWithHeartbeat(board, config, runId, worker, brief, wt, signal);
  const outcome = await decideOutcome(wt, res, async () => {
    const gateResult = await runGate(task, wt, config);
    gateOutput = gateResult.output;
    return gateResult;
  });

  const note = applyOutcome(task, outcome).note;
  const detail =
    outcome === 'needs_input'
      ? (readNeedsInput(wt.dir) ?? 'worker wrote an empty NEEDS_INPUT.md')
      : gateOutput !== undefined
        ? gateOutput
        : workerFailureDetail(res);
  return { repoDir, wt, evidence: { outcome, note, detail } };
}

/**
 * Dispatch the brief through the worker with a heartbeat running alongside:
 * every `config.heartbeatMs` a best-effort progress event goes to the board
 * (a failed heartbeat never kills the attempt), and the timer is stopped the
 * moment the spawn resolves — no timer outlives the dispatch.
 */
async function dispatchWithHeartbeat(
  board: BoardClient,
  config: RunnerConfig,
  runId: string,
  worker: Worker,
  brief: string,
  wt: Worktree,
  signal: AbortSignal | undefined,
): Promise<SpawnResult> {
  const heartbeat = setInterval(() => {
    void board
      .recordProgress(runId, `heartbeat: worker ${worker.name} still running`)
      .catch(() => undefined);
  }, config.heartbeatMs);
  try {
    return await runHeadless(worker.headless, brief, {
      cwd: wt.dir,
      timeoutMs: config.attemptTimeoutMs,
      signal,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Sleep `ms`, resolving early (and cleanly) when `signal` aborts.
 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Settle attempts orphaned by a previous runner process, logging one line
 * per orphan for the operator. {@link reconcile} never throws and never
 * deletes anything, so this can only report — a broken orphan (or an
 * unreadable workdir) degrades to a line here, never to a failed start.
 */
function settleStartupOrphans(config: RunnerConfig, board: BoardClient): Promise<void> {
  return reconcile(board, config).then((orphans) => {
    for (const orphan of orphans) {
      console.log(
        `plandesk-runner reconcile: ${orphan.taskId} ${orphan.action} — ${orphan.detail}`,
      );
    }
  });
}

/**
 * Drive {@link runOnce} until `signal` aborts: reconcile the previous
 * process's orphaned attempts **before the first poll** (a restarted runner
 * owns nothing — any `in_progress` task with a worktree under this workdir
 * was abandoned by a crash and must be released back to `todo` before this
 * process starts claiming work), then poll, settle, sleep `config.pollMs`
 * between passes (the sleep aborts with the signal, so shutdown never waits
 * out a poll). One slot — the next pass starts only after the previous
 * attempt fully settles. Errors from a pass propagate and end the loop
 * loudly; a supervisor owns restarts.
 */
export async function runLoop(
  config: RunnerConfig,
  board: BoardClient,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal?.aborted) {
    await settleStartupOrphans(config, board);
  }
  for (;;) {
    if (signal?.aborted) {
      return;
    }
    await runOnce(config, board, signal);
    if (signal?.aborted) {
      return;
    }
    await sleep(config.pollMs, signal);
  }
}
