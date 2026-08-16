import { spawn as spawnChildProcess, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Process spawning for dispatched work — the runner's only OS seam.
 *
 * Two ports meet here:
 *
 * - github.com/owainlewis/factory `internal/worker/supervisor.go` — the child
 *   runs in its own process group so a timeout or cancellation kills the
 *   whole tree (`configureExistingProcessGroup` / `stopOwnedProcessGroup`),
 *   the prompt is written to stdin and closed, output is captured with byte
 *   caps, and the result file is read bounded then deleted
 *   (`readBoundedText` + `os.Remove`).
 * - Flue's `local()` sandbox default (flueframework.com/docs/guide/sandboxes)
 *   — the model's shell does not inherit the parent environment; only a
 *   short allowlist of shell essentials passes through, everything else is an
 *   explicit per-variable opt-in.
 *
 * `spawn` is the only place in this package that touches `node:child_process`
 * — the day it becomes a container launch, this file is the whole seam.
 */

/** Options for one dispatched process. */
export interface SpawnOptions {
  /** argv, starting with the executable. Never a shell string. */
  cmd: string[];
  /** Working directory for the child (the worktree). */
  cwd: string;
  /** Complete child environment — build it with {@link buildEnv}. */
  env: Record<string, string>;
  /** Hard wall in ms; on expiry the whole process group is killed. */
  timeoutMs: number;
  /** Fires → kill the process group, resolve `reason: 'cancelled'`. */
  signal?: AbortSignal;
  /** Bytes to write to the child's stdin, then close it. Default: close empty. */
  stdin?: string;
  /** Cap on captured stdout+stderr in bytes. Default: 256_000. */
  maxOutputBytes?: number;
}

/** The outcome of one dispatched process. `spawn` resolves — it never throws. */
export interface SpawnResult {
  /**
   * The child's exit code, or null when it died to a signal (timeout and
   * cancellation kill, so null is the expected value there).
   */
  exitCode: number | null;
  reason: 'exited' | 'timeout' | 'cancelled' | 'spawn-error';
  /** Captured stdout, decoded and capped. */
  stdout: string;
  /** Captured stderr, decoded and capped; carries the cause on spawn-error. */
  stderr: string;
  /** True when stdout or stderr exceeded `maxOutputBytes` and was cut. */
  truncated: boolean;
  /** Child pid, or -1 when the process was never created. */
  pid: number;
  /** Child process group id (equals pid on POSIX), or -1 on spawn-error. */
  pgid: number;
  /** Wall time from call to resolution, in ms. */
  durationMs: number;
}

/**
 * Environment variables the child inherits from the runner by default.
 *
 * Ported from Flue's `local()` sandbox default: the model's shell gets shell
 * essentials and never API keys, tokens, or cloud credentials — which is
 * where the board's agent key would otherwise leak. `HOME` is load-bearing,
 * not incidental: pi resolves its provider auth from `~/.pi/agent/auth.json`,
 * so dropping it would unauthenticate every worker on this machine. Anything
 * outside this list must be an explicit per-variable opt-in via
 * {@link buildEnv}'s `extra` argument.
 */
export const ENV_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'TMPDIR'];

/** Default cap on captured child output, in bytes. */
export const DEFAULT_MAX_OUTPUT_BYTES = 256_000;

/**
 * Build the child environment: the {@link ENV_ALLOWLIST} entries that are
 * actually set, plus explicit opt-ins. Never spreads `process.env` — a key
 * outside the allowlist reaches the child only by being named in `extra`
 * (mirroring Flue's `env: { GH_TOKEN: ... }` opt-in). An `extra` key with the
 * same name as an allowlisted variable overrides it. Allowlisted variables
 * that are unset or empty in the runner's environment are omitted.
 */
export function buildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined && value.trim().length > 0) {
      env[name] = value;
    }
  }
  return { ...env, ...extra };
}

/** Placeholder context for {@link substitutePlaceholders}. */
export interface PlaceholderContext {
  /** Absolute worktree/repo path substituted for `{repo_path}`. */
  repoPath: string;
  /** Path of the file the brief was written to; substituted for `{prompt_file}` when present. */
  promptFile?: string;
  /** Path the worker writes its result to; substituted for `{result_file}` when present. */
  resultFile?: string;
}

/**
 * Split a worker `headless` template into argv, substituting placeholders.
 *
 * Splitting is shell-word aware — single quotes keep their contents literal,
 * double quotes and backslashes unescape per POSIX rules — so
 * `agent "--flag={prompt_file}"` yields one `--flag=/tmp/brief.md` argument
 * and a substituted path containing spaces stays a single argument. No
 * command substitution, redirection, or globbing: the result is raw argv for
 * {@link spawn}, and shell operators in a template (`$(...)`, `<`, `|`) pass
 * through as literal words. A placeholder whose context entry is absent
 * (e.g. `{result_file}` for a worker that has none) is left verbatim.
 */
export function substitutePlaceholders(
  headless: string,
  ctx: PlaceholderContext,
): string[] {
  const replacements: Array<[placeholder: string, value: string]> = [['{repo_path}', ctx.repoPath]];
  if (ctx.promptFile !== undefined) {
    replacements.push(['{prompt_file}', ctx.promptFile]);
  }
  if (ctx.resultFile !== undefined) {
    replacements.push(['{result_file}', ctx.resultFile]);
  }
  return splitWords(headless).map((word) => {
    let substituted = word;
    for (const [placeholder, value] of replacements) {
      substituted = substituted.replaceAll(placeholder, value);
    }
    return substituted;
  });
}

/** Shell-word splitter: whitespace-separated, POSIX quote and escape rules. */
function splitWords(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let hasWord = false;
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === undefined) {
      break;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (hasWord) {
        words.push(current);
        current = '';
        hasWord = false;
      }
      index += 1;
    } else if (char === "'") {
      hasWord = true;
      index += 1;
      for (;;) {
        const next = input[index];
        if (next === undefined || next === "'") {
          index += next === undefined ? 0 : 1;
          break;
        }
        current += next;
        index += 1;
      }
    } else if (char === '"') {
      hasWord = true;
      index += 1;
      for (;;) {
        const next = input[index];
        if (next === undefined || next === '"') {
          index += next === undefined ? 0 : 1;
          break;
        }
        if (next === '\\') {
          const escaped = input[index + 1];
          if (
            escaped !== undefined &&
            (escaped === '"' || escaped === '\\' || escaped === '$' || escaped === '`')
          ) {
            current += escaped;
            index += 2;
            continue;
          }
        }
        current += next;
        index += 1;
      }
    } else if (char === '\\') {
      const escaped = input[index + 1];
      if (escaped === undefined) {
        current += '\\';
        index += 1;
      } else {
        current += escaped;
        index += 2;
      }
      hasWord = true;
    } else {
      current += char;
      index += 1;
      hasWord = true;
    }
  }
  if (hasWord) {
    words.push(current);
  }
  return words;
}

/** Grace period between SIGTERM and SIGKILL (factory: `terminationGrace`). */
const TERMINATION_GRACE_MS = 5000;
/** Group-liveness poll interval during the grace window (factory: 25ms). */
const KILL_POLL_MS = 25;

/**
 * Byte-capped output capture. The stream keeps flowing after the cap so a
 * chatty child never blocks on a full pipe — bytes beyond the cap are
 * counted and dropped, never buffered.
 */
interface CappedCapture {
  chunks: Buffer[];
  total: number;
  truncated: boolean;
}

function attachCapture(stream: Readable, maxBytes: number): CappedCapture {
  const capture: CappedCapture = { chunks: [], total: 0, truncated: false };
  stream.on('data', (chunk: Buffer) => {
    const remaining = maxBytes - capture.total;
    if (remaining <= 0) {
      capture.truncated = true;
      return;
    }
    if (chunk.length > remaining) {
      capture.chunks.push(chunk.subarray(0, remaining));
      capture.total = maxBytes;
      capture.truncated = true;
      return;
    }
    capture.chunks.push(chunk);
    capture.total += chunk.length;
  });
  return capture;
}

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode bytes that may have been cut mid-multi-byte-sequence: back off to
 * the last valid UTF-8 boundary (factory: `boundedText`). A cut sequence
 * would otherwise surface as U+FFFD and corrupt the captured output.
 */
function decodeBoundedText(buffer: Buffer): string {
  let slice = buffer;
  for (;;) {
    try {
      return fatalUtf8.decode(slice);
    } catch {
      if (slice.length === 0) {
        return '';
      }
      slice = slice.subarray(0, slice.length - 1);
    }
  }
}

/** True while any process remains in the group (EPERM counts as alive). */
function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Kill the child's whole process group: SIGTERM to the group, then SIGKILL
 * if it survives {@link TERMINATION_GRACE_MS} (factory:
 * `stopOwnedProcessGroup`, minus the `ps` identity check — we hold the
 * ChildProcess handle, so Node's reaper owns the pid and reuse is not in
 * play while we are signalling). On win32, where process groups do not
 * exist, only the direct child is killed.
 */
async function killProcessTree(child: ChildProcess, pgid: number): Promise<void> {
  if (process.platform === 'win32') {
    child.kill();
    return;
  }
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    // ESRCH: already gone; anything else falls through to SIGKILL below.
  }
  const deadline = Date.now() + TERMINATION_GRACE_MS;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pgid)) {
      return;
    }
    await sleep(KILL_POLL_MS);
  }
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // ESRCH: already gone.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Start a process in its own process group and run it to a terminal state.
 *
 * Ported from factory `supervisor.go`'s runtime supervision, adapted to one
 * promise:
 *
 * - The child is made a group/session leader (`detached` → setsid), so
 *   `pgid === pid` and a kill reaches grandchildren, not just the CLI
 *   front-end — a backgrounded `sleep` the CLI left behind cannot outlive
 *   its slot.
 * - Resolution waits for the child's stdio to close (Go's `exec.Wait`
 *   semantics): a grandchild that inherited the pipes keeps the attempt
 *   open until the timeout kills the group. Deliberate — it prevents
 *   reading a "success" while work is still running.
 * - `stdin` (the brief) is written then closed; with no `stdin` the pipe is
 *   closed empty, the `< /dev/null` convention for argument-fed workers.
 * - Timeout and abort each claim the run, escalate
 *   SIGTERM → {@link TERMINATION_GRACE_MS} → SIGKILL against the group, and
 *   resolve `reason: 'timeout'` / `'cancelled'` with whatever output was
 *   captured. A binary that cannot start resolves `reason: 'spawn-error'`.
 *
 * Never throws, never rejects — every failure is a {@link SpawnResult}.
 */
export function spawn(opts: SpawnOptions): Promise<SpawnResult> {
  const startedAt = Date.now();
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<SpawnResult>((resolve) => {
    const executable = opts.cmd[0];
    if (executable === undefined || executable.length === 0) {
      resolve(spawnErrorResult('spawn requires a non-empty cmd', startedAt));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawnChildProcess(executable, opts.cmd.slice(1), {
        cwd: opts.cwd,
        env: opts.env,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (cause) {
      resolve(
        spawnErrorResult(
          `failed to start ${executable}: ${cause instanceof Error ? cause.message : String(cause)}`,
          startedAt,
        ),
      );
      return;
    }

    const pid = child.pid ?? -1;
    const pgid = process.platform === 'win32' || pid === -1 ? -1 : pid;

    const stdoutCapture = child.stdout !== null ? attachCapture(child.stdout, maxOutputBytes) : emptyCapture();
    const stderrCapture = child.stderr !== null ? attachCapture(child.stderr, maxOutputBytes) : emptyCapture();

    let claimed: SpawnResult['reason'] | undefined;
    let closed = false;
    let closeExitCode: number | null = null;
    let settled = false;

    const timer =
      opts.timeoutMs > 0
        ? setTimeout(() => {
            claim('timeout');
            void killProcessTree(child, pgid);
          }, opts.timeoutMs)
        : undefined;

    const onAbort = () => {
      claim('cancelled');
      void killProcessTree(child, pgid);
    };
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    function claim(reason: SpawnResult['reason']): void {
      if (claimed === undefined) {
        claimed = reason;
      }
      trySettle();
    }

    function trySettle(): void {
      if (settled) {
        return;
      }
      if (claimed === 'spawn-error') {
        finish('spawn-error', null, spawnErrorMessage);
        return;
      }
      if (!closed) {
        return;
      }
      finish(claimed ?? 'exited', closeExitCode, undefined);
    }

    let spawnErrorMessage: string | undefined;

    function finish(
      reason: SpawnResult['reason'],
      exitCode: number | null,
      failureMessage: string | undefined,
    ): void {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      opts.signal?.removeEventListener('abort', onAbort);
      const stderr = failureMessage === undefined
        ? decodeBoundedText(Buffer.concat(stderrCapture.chunks))
        : `${failureMessage}\n${decodeBoundedText(Buffer.concat(stderrCapture.chunks))}`;
      resolve({
        exitCode,
        reason,
        stdout: decodeBoundedText(Buffer.concat(stdoutCapture.chunks)),
        stderr,
        truncated: stdoutCapture.truncated || stderrCapture.truncated,
        pid: reason === 'spawn-error' ? -1 : pid,
        pgid: reason === 'spawn-error' ? -1 : pgid,
        durationMs: Date.now() - startedAt,
      });
    }

    child.on('error', (error) => {
      if (child.pid === undefined) {
        // The process was never created (ENOENT, EACCES, ...) — a
        // dispatch-level concern, surfaced as a result rather than a throw.
        spawnErrorMessage = `failed to start ${executable}: ${error.message}`;
        claim('spawn-error');
        return;
      }
      // Post-start delivery errors (e.g. a failed signal) leave the verdict
      // to the close event.
    });

    child.on('close', (code) => {
      closed = true;
      closeExitCode = code;
      trySettle();
    });

    const stdin = child.stdin;
    if (stdin !== null) {
      stdin.on('error', () => undefined); // EPIPE when the child exits before reading.
      stdin.end(opts.stdin ?? '');
    }
  });
}

function emptyCapture(): CappedCapture {
  return { chunks: [], total: 0, truncated: false };
}

function spawnErrorResult(message: string, startedAt: number): SpawnResult {
  return {
    exitCode: null,
    reason: 'spawn-error',
    stdout: '',
    stderr: message,
    truncated: false,
    pid: -1,
    pgid: -1,
    durationMs: Date.now() - startedAt,
  };
}

/** Bounded-read outcome for a worker result file. */
export interface BoundedText {
  text: string;
  truncated: boolean;
}

/**
 * Read up to `maxBytes` bytes of a file, flagging truncation — port of
 * factory `readBoundedText`: read `limit+1`, cut at the limit, back off to a
 * valid UTF-8 boundary. Returns undefined when the file is missing or
 * unreadable (a worker that wrote no result file is an outcome the caller
 * already handles per the result contract, not an error here).
 */
export function readBoundedFile(path: string, maxBytes: number): BoundedText | undefined {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch {
    return undefined;
  }
  const truncated = raw.length > maxBytes;
  const slice = truncated ? raw.subarray(0, maxBytes) : raw;
  return { text: decodeBoundedText(slice), truncated };
}

/** Default cap on a worker result file, in bytes (factory: `MaxResultBytes`, 256 KiB). */
export const MAX_RESULT_BYTES = 256 * 1024;

/** Options for {@link runHeadless}. */
export interface RunHeadlessOptions {
  /** Working directory: the worktree the worker operates in. */
  cwd: string;
  /** Hard wall in ms passed through to {@link spawn}. */
  timeoutMs: number;
  /** Cancellation signal passed through to {@link spawn}. */
  signal?: AbortSignal;
  /** Explicit per-variable environment opt-ins layered over {@link buildEnv}. */
  env?: Record<string, string>;
  /** Captured-output cap in bytes. Default: {@link DEFAULT_MAX_OUTPUT_BYTES}. */
  maxOutputBytes?: number;
  /** Result-file read cap in bytes. Default: {@link MAX_RESULT_BYTES}. */
  maxResultBytes?: number;
}

/**
 * {@link SpawnResult} plus the worker's result-file payload. `promptFile` and
 * `resultFile` name the temp files this run used (both deleted by the time
 * the promise resolves) so callers can assert and log the plumbing.
 */
export interface RunHeadlessResult extends SpawnResult {
  /** Text read from `{result_file}`, bounded; '' when the template had none or the worker wrote nothing. */
  result: string;
  /** True when the result file exceeded `maxResultBytes` and was cut. */
  resultTruncated: boolean;
  promptFile: string | undefined;
  resultFile: string | undefined;
}

/**
 * Dispatch one brief through a worker's `headless` template.
 *
 * The prompt/result plumbing of factory `superviseRuntime`, on top of this
 * module's own seams: the brief goes to a temp file when the template has
 * `{prompt_file}` and to stdin (then closed) when it does not; a
 * `{result_file}` temp path is substituted, read bounded after the child's
 * exit — whatever the reason, partial results included — and deleted.
 * Every temp file lives in a per-run scratch directory removed in `finally`,
 * so no path survives the attempt. The environment is always
 * {@link buildEnv} — the runner's own environment never reaches the worker.
 */
export async function runHeadless(
  headless: string,
  brief: string,
  options: RunHeadlessOptions,
): Promise<RunHeadlessResult> {
  const scratch = mkdtempSync(join(tmpdir(), 'plandesk-headless-'));
  const promptFile = headless.includes('{prompt_file}') ? join(scratch, 'brief.md') : undefined;
  const resultFile = headless.includes('{result_file}') ? join(scratch, 'result.md') : undefined;
  if (promptFile !== undefined) {
    writeFileSync(promptFile, brief);
  }

  try {
    const argv = substitutePlaceholders(headless, {
      repoPath: options.cwd,
      promptFile,
      resultFile,
    });
    const spawned = await spawn({
      cmd: argv,
      cwd: options.cwd,
      env: buildEnv(options.env),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      stdin: promptFile !== undefined ? undefined : brief,
      maxOutputBytes: options.maxOutputBytes,
    });

    let result = '';
    let resultTruncated = false;
    if (resultFile !== undefined) {
      const bounded = readBoundedFile(resultFile, options.maxResultBytes ?? MAX_RESULT_BYTES);
      result = bounded?.text ?? '';
      resultTruncated = bounded?.truncated ?? false;
    }
    return { ...spawned, result, resultTruncated, promptFile, resultFile };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
