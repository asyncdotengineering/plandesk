import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RunnerConfig } from './config.js';
import type { BoardAgentRun, BoardClient, BoardTask } from './board.js';
import { GitError, listWorktrees, samePath, type WorktreeEntry } from './worktree.js';

/**
 * Startup reconciliation of attempts orphaned by a previous runner process.
 *
 * A crash leaves no record of itself: if the runner dies mid-attempt, the
 * task stays `in_progress` on the board and its worktree sits under
 * `<workdir>/worktrees/` with no owner, and nothing else will ever clean
 * that up — the board cannot distinguish a working agent from a dead one.
 * This module is what a restarted runner does about it.
 *
 * Ported from github.com/owainlewis/factory `internal/worker/reconcile.go`
 * ("reconciles manifests, worktrees, and owned process groups after
 * restart"), reduced to v1's world: there is no attempt table and no lease
 * to adopt, so in-flight work is **released** — returned to `todo` for a
 * fresh attempt — never resumed. The recovery discipline is Flue's
 * (flueframework.com/docs/guide/durability): *a crash leaves no record of
 * itself, so recovery works exclusively from durable evidence.* Everything
 * here classifies from what is on disk (the worktree directory and its
 * `git worktree list` registration) and on the board (the task's status and
 * the runs list); nothing is classified from what this process remembers,
 * because it remembers nothing.
 *
 * The cleanup posture is inherited from {@link "./worktree.js"}
 * (`retainOrRemove`): reconcile is read-and-release only and **never
 * deletes anything** — every branch retains the worktree on disk for
 * inspection, and every {@link Orphan.detail} names the retained path.
 */

/** One orphaned attempt worktree found at startup and what reconciliation did with it. */
export interface Orphan {
  /** The task id as recoverable from disk: the worktree directory's name. */
  taskId: string;
  /**
   * Absolute path of the retained worktree, `<workdir>/worktrees/<taskId>`.
   * Null when the attempt died before one existed — those are found on the
   * board rather than on disk.
   */
  worktreeDir: string | null;
  /**
   * The task's status as read from the board — durable evidence at scan
   * time, not the post-reconcile value. Null when the task no longer exists
   * on the board (or its status could not be read).
   */
  boardStatus: string | null;
  /** What reconciliation decided. `returned-to-todo` is the only settling action. */
  action: 'returned-to-todo' | 'left-alone' | 'unresolvable';
  /** Human-readable evidence trail; always names the retained worktree path. */
  detail: string;
}

/** A worktree directory on disk plus the git registration evidence found for it. */
interface ScannedOrphan {
  taskId: string;
  worktreeDir: string;
  /** The `git worktree list` registration that covers this directory, when one was found. */
  registration?: { repoDir: string; branch?: string; head?: string };
  /** Why no registration could be produced (a repo whose listing failed). */
  registrationError?: string;
}

/** readdir entries of one directory, names only, directories only, sorted for determinism. */
function directoryNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Enumerate every orphaned-attempt candidate under `<workdir>/worktrees/`
 * together with its registration in `git worktree list`.
 *
 * The task id is the directory name: {@link "./worktree.js"}
 * `prepareWorktree` creates worktrees at
 * `<workdir>/worktrees/<sanitizeSegment(taskId)>`, so the directory name is
 * the durable key on disk. Task ids whose sanitized segment differs from the
 * raw board id simply fail the board lookup downstream and are left alone —
 * fail closed, never guessed.
 *
 * Registration evidence comes from every repository cache under
 * `<workdir>/repos/` that is a git clone (`prepareWorktree` registers the
 * worktree in the clone that created it). A repo whose `git worktree list`
 * fails is skipped and the failure is reported per orphan — a broken
 * registration lookup degrades the detail, never the classification, because
 * the directory itself is the evidence that an attempt happened.
 *
 * Throws only when the `worktrees/` enumeration itself fails (the directory
 * exists but cannot be read); callers who must not throw wrap it.
 */
async function scanOrphansWithEvidence(config: RunnerConfig): Promise<ScannedOrphan[]> {
  const worktreesDir = join(config.workdir, 'worktrees');
  if (!existsSync(worktreesDir)) {
    return [];
  }
  const candidates = directoryNames(worktreesDir);
  if (candidates.length === 0) {
    return [];
  }

  const reposDir = join(config.workdir, 'repos');
  const listed: Array<{ repoDir: string; entry: WorktreeEntry }> = [];
  const registrationErrors: string[] = [];
  if (existsSync(reposDir)) {
    for (const name of directoryNames(reposDir)) {
      const repoDir = join(reposDir, name);
      if (!existsSync(join(repoDir, '.git'))) {
        continue; // not a repository cache — it is someone's data, not evidence
      }
      try {
        for (const entry of await listWorktrees(repoDir)) {
          listed.push({ repoDir, entry });
        }
      } catch (error) {
        const message = error instanceof GitError ? error.message : String(error);
        registrationErrors.push(message);
      }
    }
  }

  return candidates.map((name) => {
    const worktreeDir = join(worktreesDir, name);
    const match = listed.find(({ entry }) => samePath(entry.path, worktreeDir));
    if (match !== undefined) {
      return {
        taskId: name,
        worktreeDir,
        registration: { repoDir: match.repoDir, branch: match.entry.branch, head: match.entry.head },
      };
    }
    return {
      taskId: name,
      worktreeDir,
      ...(registrationErrors.length > 0 ? { registrationError: registrationErrors.join('; ') } : {}),
    };
  });
}

/**
 * Enumerate the orphaned attempt worktrees under `<workdir>/worktrees/`,
 * as `{ taskId, worktreeDir }` pairs. Pure inventory — reads the disk and
 * git registrations only, never the board, never settles anything (doctor
 * reports this set verbatim).
 */
export async function scanOrphans(
  config: RunnerConfig,
): Promise<Array<{ taskId: string; worktreeDir: string }>> {
  const scanned = await scanOrphansWithEvidence(config);
  return scanned.map(({ taskId, worktreeDir }) => ({ taskId, worktreeDir }));
}

/** Render the registration evidence for one orphan's detail line. */
function registrationDetail(orphan: ScannedOrphan, config: RunnerConfig): string {
  if (orphan.registration !== undefined) {
    const branch =
      orphan.registration.branch !== undefined ? ` on ${orphan.registration.branch}` : '';
    return `git worktree registered${branch} under ${orphan.registration.repoDir}`;
  }
  if (orphan.registrationError !== undefined) {
    return `git worktree registration lookup failed (${orphan.registrationError}) — directory evidence only`;
  }
  return `no git worktree registration under ${join(config.workdir, 'repos')} — directory evidence only`;
}

/**
 * The still-`running` agent run on the board that belongs to `taskId`'s
 * interrupted attempt. The loop labels every run it starts
 * `task <taskId>: <label>` (see {@link "./loop.js"} `runOnce`), so the label
 * prefix is the durable link from a task to its attempt's run — the board's
 * run list (`GET /projects/:id/agent-runs`) is sorted newest first, and the
 * first running match is taken.
 */
function isInterruptedAttemptRun(taskId: string): (run: BoardAgentRun) => boolean {
  const prefix = `task ${taskId}: `;
  return (run) => run.status === 'running' && run.label !== null && run.label.startsWith(prefix);
}

/** The progress event recorded on the interrupted attempt's run. */
function interruptionMessage(config: RunnerConfig, worktreeDir: string): string {
  return (
    `attempt interrupted: runner ${config.name} restarted while this run was in flight — ` +
    `no agent is working it. Task returned to todo for redispatch; ` +
    `the worktree is retained for inspection at ${worktreeDir}`
  );
}

/** Fold an unknown thrown value into one diagnostic line. */
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reconcile one orphaned attempt against the board, from durable evidence
 * only. Never throws — every failure path is an {@link Orphan} with the
 * error in its detail, so one broken orphan cannot stop the others.
 */
async function reconcileOne(
  board: BoardClient,
  config: RunnerConfig,
  orphan: ScannedOrphan,
): Promise<Orphan> {
  const { taskId, worktreeDir } = orphan;
  const evidence = registrationDetail(orphan, config);
  let boardStatus: string | null = null;
  try {
    // There is no GET /tasks/:id route; the project task list is the read.
    const task: BoardTask | undefined = (await board.listTasks()).find(
      (candidate) => candidate.id === taskId,
    );
    if (task === undefined) {
      return {
        taskId,
        worktreeDir,
        boardStatus: null,
        action: 'left-alone',
        detail: `task ${taskId} no longer exists on the board — nothing to release; worktree retained at ${worktreeDir} (${evidence})`,
      };
    }
    boardStatus = task.status;

    if (task.status !== 'in_progress') {
      return {
        taskId,
        worktreeDir,
        boardStatus,
        action: 'left-alone',
        detail: `task is ${task.status}, not in_progress — no in-flight attempt to release; worktree retained at ${worktreeDir} (${evidence})`,
      };
    }

    // The task claims an agent is working it. This runner just started and
    // owns nothing, so that agent is dead — release the work. The release
    // write needs an agent run to attribute to (agent-key task writes carry
    // x-plandesk-agent-run-id naming a running run), and the interrupted
    // attempt's own run is still running on the board: the crash completed
    // nothing. Reusing it keeps the interruption on the run that owns the
    // work, rather than opening a second run for the same attempt.
    const run = (await board.listRuns()).find(isInterruptedAttemptRun(taskId));
    if (run === undefined) {
      return {
        taskId,
        worktreeDir,
        boardStatus,
        action: 'unresolvable',
        detail: `task is in_progress but no running agent run labelled 'task ${taskId}: …' exists on the board to attribute the release to — a task-status write under an agent key requires a running run; nothing settled, worktree retained at ${worktreeDir} (${evidence})`,
      };
    }

    // Same order as runOnce settles: narrate on the run, then mutate the
    // task. The progress event is the explanation; the status flip is the
    // durable signal. A failed event does not block the flip — the flip is
    // what frees the task — but it is reported in the detail.
    let progressError: string | undefined;
    try {
      await board.recordProgress(run.id, interruptionMessage(config, worktreeDir));
    } catch (error) {
      progressError = errorDetail(error);
    }
    await board.setTaskStatus(taskId, 'todo', run.id);
    return {
      taskId,
      worktreeDir,
      boardStatus,
      action: 'returned-to-todo',
      detail:
        `task was in_progress with its attempt's run ${run.id} still running — interruption recorded on that run, task returned to todo` +
        (progressError !== undefined ? ` (progress event could not be recorded: ${progressError})` : '') +
        `; worktree retained at ${worktreeDir} (${evidence})`,
    };
  } catch (error) {
    return {
      taskId,
      worktreeDir,
      boardStatus,
      action: 'unresolvable',
      detail: `reconcile could not settle this orphan: ${errorDetail(error)} — nothing settled by this failure, worktree retained at ${worktreeDir} (${evidence})`,
    };
  }
}

/**
 * Reconcile every attempt orphaned under this runner's `<workdir>/worktrees/`
 * against the board, and report what was found and done. Classification, in
 * order, from durable evidence only:
 *
 * - task not on the board → `left-alone` (reported, retained, not deleted);
 * - task `in_progress` + its interrupted attempt's run still `running` on
 *   the board → the interruption is recorded on that run via
 *   `POST /agent-runs/:id/progress` and the task is returned to `todo`
 *   (`PATCH /tasks/:id` attributed to that run) — `returned-to-todo`;
 * - task `in_progress` but no attributable running run → `unresolvable`
 *   (an agent-key status write would be rejected without one; a human
 *   settles it), nothing written;
 * - task in any other status → `left-alone`.
 *
 * A failure reading or writing the board for one orphan becomes that
 * orphan's `unresolvable` record and does not abort the others; `reconcile`
 * never throws out of itself, and a total scan failure resolves `[]` — one
 * unrecoverable orphan (or workdir) must not stop the runner from starting.
 * The worktree is retained in every branch: reconcile never deletes
 * anything, ever.
 */
export async function reconcile(board: BoardClient, config: RunnerConfig): Promise<Orphan[]> {
  let scanned: ScannedOrphan[];
  try {
    scanned = await scanOrphansWithEvidence(config);
  } catch {
    // The inventory itself is unreadable — there is no provable orphan set,
    // so there is nothing safe to settle. Fail closed, start the runner.
    return [];
  }
  const orphans: Orphan[] = [];
  for (const candidate of scanned) {
    orphans.push(await reconcileOne(board, config, candidate));
  }
  orphans.push(...(await reconcileStranded(board, config, orphans)));
  return orphans;
}

/**
 * Tasks this runner claimed whose attempt died **before** `prepareWorktree`
 * ran — a clone that failed, an unreachable board, a full disk. The disk scan
 * cannot see them because there is no directory to find, so without this
 * sweep they stay `in_progress` forever: a mistyped `repo_url` would strand
 * every task its project dispatches, one at a time, permanently.
 *
 * Only tasks assigned to THIS runner are settled. A task claimed by another
 * runner may have a live process working it, and stealing it is worse than
 * leaving it; an unassigned `in_progress` task was not claimed here either.
 *
 * A run is opened only when there is something to narrate — this is the one
 * place reconcile starts a run, and an empty sweep must stay silent.
 */
async function reconcileStranded(
  board: BoardClient,
  config: RunnerConfig,
  fromDisk: readonly Orphan[],
): Promise<Orphan[]> {
  let tasks: BoardTask[];
  try {
    tasks = await board.listTasks();
  } catch {
    // The board is the thing that failed. There is no provable stranded set,
    // so settle nothing and let the runner start.
    return [];
  }

  const settledFromDisk = new Set(fromDisk.map((orphan) => orphan.taskId));
  const stranded = tasks.filter(
    (task) =>
      task.status === 'in_progress' &&
      task.assignee === config.name &&
      !settledFromDisk.has(task.id),
  );
  if (stranded.length === 0) {
    return [];
  }

  let run: BoardAgentRun;
  try {
    run = await board.startRun(`reconcile: release ${String(stranded.length)} stranded task(s)`);
  } catch (error) {
    return stranded.map((task) => ({
      taskId: task.id,
      worktreeDir: null,
      boardStatus: task.status,
      action: 'unresolvable' as const,
      detail: `task is in_progress with no worktree, but no agent run could be opened to attribute the release to: ${errorDetail(error)}`,
    }));
  }

  const released: Orphan[] = [];
  for (const task of stranded) {
    const explanation =
      `task was claimed by ${config.name} but its attempt left no worktree under ` +
      `${join(config.workdir, 'worktrees')} — it failed before one was prepared`;
    try {
      await board.recordProgress(run.id, `${explanation}; returning it to todo`).catch(() => {
        // The status flip is what frees the task; a lost event must not block it.
      });
      await board.setTaskStatus(task.id, 'todo', run.id);
      released.push({
        taskId: task.id,
        worktreeDir: null,
        boardStatus: task.status,
        action: 'returned-to-todo',
        detail: `${explanation}; returned to todo`,
      });
    } catch (error) {
      released.push({
        taskId: task.id,
        worktreeDir: null,
        boardStatus: task.status,
        action: 'unresolvable',
        detail: `${explanation}; the release write failed: ${errorDetail(error)}`,
      });
    }
  }
  await board.completeRun(run.id, 'completed').catch(() => undefined);
  return released;
}
