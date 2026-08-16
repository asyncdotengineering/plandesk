import { exec } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import type { RunnerConfig } from './config.js';

const execAsync = promisify(exec);

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_VERSION_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1_024 * 1_024;

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
 * ignored. This is a listing only — use {@link resolveWorkers} to probe them.
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

/** The keys recognised in a worker file's YAML frontmatter. */
export interface WorkerFrontmatter {
  type?: string;
  probe?: string;
  version?: string;
  command?: string;
  headless?: string;
}

const FRONTMATTER_KEYS = ['type', 'probe', 'version', 'command', 'headless'] as const;

/**
 * Parse the YAML frontmatter of a worker declaration file. Returns the
 * recognised string keys, or undefined when there is no frontmatter block, the
 * block is never closed, or the YAML does not parse. Keys whose value is not a
 * non-empty string (arrays, numbers, whitespace-only strings) are dropped — a
 * dropped `headless` makes the file headless-unusable downstream.
 */
export function parseWorkerFrontmatter(content: string): WorkerFrontmatter | undefined {
  const lines = content.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== '---') {
    return undefined;
  }
  const body: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && line.trim() === '---') {
      return readFrontmatter(body.join('\n'));
    }
    body.push(line ?? '');
  }
  return undefined;
}

function readFrontmatter(body: string): WorkerFrontmatter | undefined {
  let parsed: unknown;
  try {
    parsed = parseYaml(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const raw = parsed as Record<string, unknown>;
  const frontmatter: WorkerFrontmatter = {};
  for (const key of FRONTMATTER_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

/** A resolved, dispatch-ready worker. */
export interface Worker {
  /** Worker id — the file basename without `.md`. */
  name: string;
  /** Shell command whose exit 0 proves the CLI is installed on this host. */
  probe: string;
  /** The command whose stdout reports the CLI version — not the result. */
  version?: string;
  /** The interactive-path dispatch command template. */
  command?: string;
  /** The headless dispatch command template. */
  headless: string;
  /** Trimmed stdout of `version`, captured at resolution time. */
  resolvedVersion?: string;
  /** True when `headless` contains a `{prompt_file}` placeholder. */
  usesPromptFile: boolean;
  /** True when `headless` contains a `{result_file}` placeholder. */
  usesResultFile: boolean;
}

/** Why a repo-declared worker did not make it into the usable set. */
export type Exclusion =
  | { worker: string; reason: 'no-headless-key' }
  | { worker: string; reason: 'not-enabled-in-config' }
  | { worker: string; reason: 'probe-failed'; stderr: string };

/** The outcome of declare-then-probe resolution. */
export interface WorkerResolution {
  usable: Worker[];
  excluded: Exclusion[];
}

/**
 * Thrown when worker resolution ends with an empty usable set. Carries all
 * three sets so the message can explain every exclusion; never thrown when at
 * least one worker is usable — a failing probe removes only that worker.
 */
export class NoUsableWorkersError extends Error {
  /** Worker ids the repository declared (all `*.md` files). */
  readonly declared: string[];
  /** Worker ids this machine enabled: `config.workers`, or `declared` when empty. */
  readonly enabled: string[];
  /** Every exclusion recorded during resolution, in file order. */
  readonly excluded: Exclusion[];

  constructor(declared: string[], enabled: string[], excluded: Exclusion[], note?: string) {
    super(
      `no usable workers — declared: [${declared.join(', ')}]; enabled: [${enabled.join(', ')}]; ` +
        `excluded: ${formatExclusions(excluded)}${note === undefined ? '' : ` (${note})`}`,
    );
    this.name = 'NoUsableWorkersError';
    this.declared = declared;
    this.enabled = enabled;
    this.excluded = excluded;
  }
}

/** One human-readable line for an exclusion (used in errors and doctor rows). */
export function describeExclusion(exclusion: Exclusion): string {
  switch (exclusion.reason) {
    case 'no-headless-key':
      return 'no headless key in its worker file';
    case 'not-enabled-in-config':
      return 'not enabled in the runner config';
    case 'probe-failed':
      return `probe failed: ${flatten(exclusion.stderr)}`;
  }
}

function formatExclusions(excluded: Exclusion[]): string {
  if (excluded.length === 0) {
    return '(none)';
  }
  return excluded
    .map((exclusion) => `${exclusion.worker} (${describeExclusion(exclusion)})`)
    .join('; ');
}

/** Collapse whitespace so multi-line stderr stays on one diagnostic line. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Options for probe/version subprocesses during resolution. */
export interface ResolveWorkersOptions {
  /** Working directory for probe/version subprocesses. Default: process.cwd(). */
  cwd?: string;
  /** Probe timeout per worker in ms. Default: 10000. */
  probeTimeoutMs?: number;
  /** Version-command timeout per worker in ms. Default: 10000. */
  versionTimeoutMs?: number;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run a worker-declared shell command and capture its output without ever
 * throwing: the caller decides whether a failure is fatal. On failure the
 * captured stderr is returned; when the command wrote nothing to stderr (e.g.
 * a bare `exit 1`) the exec error message stands in so diagnostics are never
 * blank.
 */
async function runShellCommand(
  command: string,
  options: ResolveWorkersOptions,
  timeoutMs: number,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: options.cwd,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr };
  } catch (cause) {
    const partial = cause as { stderr?: unknown };
    const captured = typeof partial.stderr === 'string' ? partial.stderr : '';
    if (captured.trim().length > 0) {
      return { ok: false, stdout: '', stderr: captured };
    }
    return {
      ok: false,
      stdout: '',
      stderr: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Resolve the usable worker set from one workers directory, declare-then-probe.
 *
 * Ported from github.com/owainlewis/factory: one runner may advertise several
 * installed coding agents, and missing or unauthenticated runtimes remain
 * visible without stopping ready runtimes. Concretely, in file order, every
 * worker passes three gates — the first failure records an {@link Exclusion}
 * and moves on:
 *
 * 1. The file must declare a usable headless command (a `headless` string plus
 *    a `probe` string; files without them are recorded `no-headless-key` and
 *    stay valid for the interactive path).
 * 2. When `config.workers` is non-empty, the worker must be listed; otherwise
 *    it is recorded `not-enabled-in-config`. An empty list accepts all
 *    repo-declared workers.
 * 3. The `probe` command must exit 0; anything else records `probe-failed`
 *    with the captured stderr. A failing probe removes only that worker — it
 *    never aborts resolution.
 *
 * Survivors get `version` run (failure there is informational, not excluding)
 * and its trimmed stdout recorded as `resolvedVersion`. Throws
 * {@link NoUsableWorkersError} — naming the declared set, the enabled set, and
 * every exclusion — only when the usable set ends up empty.
 */
export async function resolveWorkersIn(
  workersDir: string,
  config: RunnerConfig,
  options: ResolveWorkersOptions = {},
): Promise<WorkerResolution> {
  const files = listWorkerFiles(workersDir);
  const declared = files.map((file) => file.id);
  const enabled = config.workers.length > 0 ? [...config.workers] : declared;
  const enabledFilter = config.workers.length > 0 ? new Set(config.workers) : undefined;

  const usable: Worker[] = [];
  const excluded: Exclusion[] = [];

  for (const file of files) {
    const frontmatter = readWorkerFile(file.path);
    if (frontmatter?.headless === undefined || frontmatter.probe === undefined) {
      excluded.push({ worker: file.id, reason: 'no-headless-key' });
      continue;
    }
    if (enabledFilter !== undefined && !enabledFilter.has(file.id)) {
      excluded.push({ worker: file.id, reason: 'not-enabled-in-config' });
      continue;
    }

    const probe = await runShellCommand(
      frontmatter.probe,
      options,
      options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    );
    if (!probe.ok) {
      excluded.push({ worker: file.id, reason: 'probe-failed', stderr: probe.stderr });
      continue;
    }

    const worker: Worker = {
      name: file.id,
      probe: frontmatter.probe,
      version: frontmatter.version,
      command: frontmatter.command,
      headless: frontmatter.headless,
      usesPromptFile: frontmatter.headless.includes('{prompt_file}'),
      usesResultFile: frontmatter.headless.includes('{result_file}'),
    };
    if (frontmatter.version !== undefined) {
      const version = await runShellCommand(
        frontmatter.version,
        options,
        options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS,
      );
      const trimmed = version.stdout.trim();
      if (version.ok && trimmed.length > 0) {
        worker.resolvedVersion = trimmed;
      }
    }
    usable.push(worker);
  }

  if (usable.length === 0) {
    throw new NoUsableWorkersError(declared, enabled, excluded);
  }
  return { usable, excluded };
}

/** Read and parse one worker file; an unreadable file counts as headless-unusable. */
function readWorkerFile(path: string): WorkerFrontmatter | undefined {
  try {
    return parseWorkerFrontmatter(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the usable worker set for a worktree: find its
 * `.agents/factory/workers` directory (walking up), then declare-then-probe
 * via {@link resolveWorkersIn}. Throws {@link NoUsableWorkersError} when no
 * workers directory exists anywhere above `worktreeDir`, or when resolution
 * ends with an empty usable set.
 */
export async function resolveWorkers(
  worktreeDir: string,
  config: RunnerConfig,
  options: Omit<ResolveWorkersOptions, 'cwd'> = {},
): Promise<WorkerResolution> {
  const workersDir = findFactoryWorkersDir(worktreeDir);
  if (workersDir === undefined) {
    throw new NoUsableWorkersError(
      [],
      config.workers.length > 0 ? [...config.workers] : [],
      [],
      `no .agents/factory/workers directory found under ${worktreeDir}`,
    );
  }
  return resolveWorkersIn(workersDir, config, { ...options, cwd: worktreeDir });
}

/**
 * Pick the worker to dispatch to. Honours `config.defaultWorker` when it is
 * usable; otherwise returns the first usable worker sorted by name. Routing by
 * task shape is deliberately not implemented in v1.
 */
export function pickWorker(usable: Worker[], config: RunnerConfig): Worker {
  const defaultWorker = config.defaultWorker;
  if (defaultWorker !== undefined) {
    const preferred = usable.find((worker) => worker.name === defaultWorker);
    if (preferred !== undefined) {
      return preferred;
    }
  }
  const sorted = [...usable].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const first = sorted[0];
  if (first === undefined) {
    throw new Error('pickWorker requires at least one usable worker');
  }
  return first;
}
