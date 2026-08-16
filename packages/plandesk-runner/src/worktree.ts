import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { RunnerConfig } from './config.js';

/**
 * Per-attempt git worktrees for the runner.
 *
 * Ported from github.com/owainlewis/factory (ARCHITECTURE.md invariants 6-7,
 * internal/worker/reconcile.go, internal/worker/cleanup.go, internal/worker/git.go)
 * with the ignored-only carve-out and argv discipline of
 * github.com/narumiruna/pi-extensions packages/pi-worktree. The governing
 * invariant is factory's: **cleanup fails closed** — dirty, failed,
 * cancelled, or uncertain worktrees are retained for inspection, and removal
 * happens only when repository, path, branch, and worktree registration can
 * all be proved.
 *
 * Every git call in this module is an argv array passed to execFile; no task
 * id, branch name, or URL is ever interpolated into a shell string.
 */

const GIT_TIMEOUT_MS = 60_000;
const GIT_REMOTE_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Full lowercase object id: 40 hex (SHA-1) or 64 hex (SHA-256). */
const FULL_OID_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

/**
 * One prepared attempt checkout. `dir` and `branch` are what
 * {@link retainOrRemove} must re-prove before any removal; `baseOid` is the
 * full OID the worktree was created at (never a branch name — a branch name
 * does not resolve the same way twice).
 */
export interface Worktree {
  /** Absolute path of the worktree, `<workdir>/worktrees/<segment>`. */
  dir: string;
  /** Branch checked out in the worktree, `task/<segment>`. */
  branch: string;
  /** Full OID the worktree was created at. */
  baseOid: string;
  /** Slug of the repository cache this worktree belongs to. */
  repoSlug: string;
}

/**
 * What {@link retainOrRemove} decided. `removed` carries the ignored-only
 * paths that were about to be lost (pi-worktree lists them in its destructive
 * confirmation); `retained` carries a machine-readable reason and a
 * human-readable detail.
 */
export type CleanupDecision =
  | { action: 'removed'; ignoredPaths: string[] }
  | {
      action: 'retained';
      reason: 'dirty' | 'unpushed' | 'unproven' | 'outcome-not-done';
      detail: string;
    };

/**
 * Raised when a git subprocess exits non-zero, cannot be spawned, or times
 * out. `argv` is the exact argument vector that was run (proving no shell was
 * involved) and `stderr` is the captured standard error.
 */
export class GitError extends Error {
  /** The argument vector after `git` itself, e.g. `['worktree', 'add', ...]`. */
  readonly argv: string[];
  /** Captured stderr of the failed command; may be empty for spawn failures. */
  readonly stderr: string;

  constructor(argv: string[], stderr: string, message?: string, options?: ErrorOptions) {
    super(
      message ?? `git ${argv.join(' ')} failed: ${flatten(stderr) || 'no stderr captured'}`,
      options,
    );
    this.name = 'GitError';
    this.argv = argv;
    this.stderr = stderr;
  }
}

/**
 * Raised for module-level validation failures — an unusable repository URL,
 * a task id that sanitizes to nothing, a base OID that is not a full OID, or
 * a remote that does not advertise a default branch. `field` names the
 * offending input, mirroring ConfigError in ./config.ts.
 */
export class WorktreeError extends Error {
  /** The offending input: `repoUrl`, `taskId`, `baseOid`, or `origin`. */
  readonly field: string;

  constructor(field: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorktreeError';
    this.field = field;
  }
}

/**
 * Run one git command as an argv array (never a shell string) and return its
 * stdout. Non-zero exit, missing git binary, or timeout raises
 * {@link GitError} carrying the argv and stderr. Ported rule from
 * pi-worktree: "Runs Git through argv-based subprocess calls, without
 * interpolating user input into shell commands."
 */
function runGit(args: string[], cwd?: string, timeoutMs: number = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const detail = flatten(stderr).length > 0 ? flatten(stderr) : error.message;
          rejectPromise(new GitError(args, stderr, `git ${args.join(' ')} failed: ${detail}`, { cause: error }));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

/** Collapse whitespace so multi-line stderr stays on one diagnostic line. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Map a task id or repository slug to a segment usable as a single
 * filesystem component under the runner's workdir and as a ref component
 * under `task/`. Every character outside `[A-Za-z0-9._-]` becomes `-` (this
 * is what neutralises shell metacharacters such as `;`, spaces, and `$( )`
 * and path separators); `..` runs collapse to `.`; leading dots and a
 * trailing `.lock` are removed because they are invalid in ref names.
 * Deterministic: the same input always yields the same segment.
 */
function sanitizeSegment(input: string): string {
  let segment = input.replace(/[^A-Za-z0-9._-]/g, '-');
  segment = segment.replace(/\.{2,}/g, '.');
  segment = segment.replace(/^\.+/, '');
  if (segment.endsWith('.lock')) {
    segment = segment.slice(0, -'.lock'.length);
  }
  return segment;
}

/**
 * Validate a task id and return its safe segment, or raise
 * {@link WorktreeError} naming `taskId` when nothing usable remains.
 */
function worktreeSegment(taskId: string): string {
  const segment = sanitizeSegment(taskId.trim());
  if (segment.length === 0 || segment === '.' || segment === '..') {
    throw new WorktreeError(
      'taskId',
      `task id ${JSON.stringify(taskId)} has no usable worktree segment after sanitisation`,
    );
  }
  return segment;
}

/**
 * Derive the cache directory slug for a repository URL: the last path
 * component (after `/` or scp-style `:`), minus a trailing `/` and `.git`,
 * sanitized by {@link sanitizeSegment}. `https://github.com/acme/widget.git`
 * and `git@github.com:acme/widget.git` both yield `widget`.
 */
function repoSlugFromUrl(repoUrl: string): string {
  let url = repoUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('.git')) {
    url = url.slice(0, -'.git'.length);
  }
  const lastSlash = Math.max(url.lastIndexOf('/'), url.lastIndexOf(':'));
  const base = lastSlash >= 0 ? url.slice(lastSlash + 1) : url;
  const slug = sanitizeSegment(base);
  if (slug.length === 0 || slug === '.' || slug === '..') {
    throw new WorktreeError(
      'repoUrl',
      `repository URL ${JSON.stringify(repoUrl)} has no usable cache slug`,
    );
  }
  return slug;
}

/**
 * Maintain the per-repository clone cache under `<workdir>/repos/<slug>`:
 * clone on first use, return the existing clone's path afterwards. Ports
 * factory ARCHITECTURE.md §3 ("Eligible Workers clone them on demand, keep
 * them cached, fetch before an Attempt") — the fetch lives in
 * {@link resolveBaseCommit}, which is what runs before each attempt.
 *
 * Fails closed on a directory that exists but is not a git clone (it may be
 * someone's data): nothing is cloned over it.
 */
export async function ensureRepo(repoUrl: string, config: RunnerConfig): Promise<string> {
  const trimmed = repoUrl.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) {
    throw new WorktreeError(
      'repoUrl',
      `repository URL ${JSON.stringify(repoUrl)} must be a non-empty URL or path, not an option-looking string`,
    );
  }
  const slug = repoSlugFromUrl(trimmed);
  const repoDir = join(config.workdir, 'repos', slug);
  if (existsSync(join(repoDir, '.git'))) {
    return repoDir;
  }
  if (existsSync(repoDir)) {
    throw new WorktreeError(
      'repoUrl',
      `${repoDir} already exists but is not a git clone — refusing to clone over it`,
    );
  }
  mkdirSync(join(config.workdir, 'repos'), { recursive: true });
  await runGit(['clone', '--', trimmed, repoDir], undefined, GIT_REMOTE_TIMEOUT_MS);
  return repoDir;
}

/**
 * Fetch the remote and resolve the base commit for the next attempt as a
 * **full OID taken from the remote's advertised default branch** — never a
 * branch name, which does not resolve the same way twice. Ports factory
 * internal/worker/git.go `discoverRemoteDefaultBranch` (`ls-remote --symref
 * origin HEAD`).
 *
 * The fetch first (per factory: fetch before an Attempt) pulls the objects;
 * `ls-remote` then pins the OID the remote points at *right now*, and
 * `cat-file -e` proves the commit object actually exists locally before the
 * OID is handed to {@link prepareWorktree}. A remote that does not advertise
 * a symbolic HEAD, or an OID the fetch did not deliver, raises
 * {@link WorktreeError} / {@link GitError} — never a guess.
 */
export async function resolveBaseCommit(repoDir: string): Promise<string> {
  await runGit(['fetch', 'origin', '--prune'], repoDir, GIT_REMOTE_TIMEOUT_MS);
  const stdout = await runGit(['ls-remote', '--symref', 'origin', 'HEAD'], repoDir, GIT_REMOTE_TIMEOUT_MS);

  let branch: string | undefined;
  let oid: string | undefined;
  for (const line of stdout.split('\n')) {
    // Whitespace-split like factory's strings.Fields: the symref line reads
    // `ref: refs/heads/main\tHEAD` and the oid line `<oid>\tHEAD`.
    const fields = line.trim().split(/\s+/).filter((field) => field.length > 0);
    if (fields.length === 3 && fields[0] === 'ref:' && fields[2] === 'HEAD') {
      const name = fields[1] ?? '';
      if (name.startsWith('refs/heads/')) {
        branch = name.slice('refs/heads/'.length);
      }
    } else if (fields.length === 2 && fields[1] === 'HEAD' && FULL_OID_PATTERN.test(fields[0] ?? '')) {
      oid = fields[0];
    }
  }
  if (branch === undefined || oid === undefined) {
    throw new WorktreeError(
      'origin',
      `origin of ${repoDir} did not advertise a default branch (ls-remote --symref origin HEAD)`,
    );
  }
  await runGit(['cat-file', '-e', `${oid}^{commit}`], repoDir);
  return oid;
}

/**
 * Create `<workdir>/worktrees/<taskId>` on branch `task/<taskId>` at exactly
 * `baseOid`, and return the {@link Worktree} record. Ports factory
 * internal/worker/git.go `addPreparedWorktree` (`worktree add -b <branch>
 * <path> <commit>`) — the branch is created at the approved full OID even if
 * the remote moves afterwards, and the created worktree's HEAD is verified
 * against that OID before the record is returned (pi-worktree's post-add
 * verification). A mismatch leaves the worktree in place for inspection and
 * throws; it is never rolled back.
 *
 * `taskId` is sanitized to a safe path/ref segment (see
 * {@link worktreeSegment}); shell metacharacters can survive into neither the
 * branch nor the directory name, and neither ever reaches a shell anyway.
 */
export async function prepareWorktree(
  repoDir: string,
  taskId: string,
  baseOid: string,
  config: RunnerConfig,
): Promise<Worktree> {
  if (!FULL_OID_PATTERN.test(baseOid)) {
    throw new WorktreeError(
      'baseOid',
      `base commit ${JSON.stringify(baseOid)} must be a full (40/64 hex) object id`,
    );
  }
  const segment = worktreeSegment(taskId);
  const branch = `task/${segment}`;
  const dir = join(config.workdir, 'worktrees', segment);
  if (existsSync(dir)) {
    throw new WorktreeError(
      'taskId',
      `worktree directory ${dir} already exists — refusing to prepare over it (task id ${JSON.stringify(taskId)})`,
    );
  }
  mkdirSync(join(config.workdir, 'worktrees'), { recursive: true });
  await runGit(['worktree', 'add', '-b', branch, dir, baseOid], repoDir);

  const head = (await runGit(['rev-parse', 'HEAD'], dir)).trim();
  if (head !== baseOid) {
    throw new WorktreeError(
      'baseOid',
      `worktree ${dir} was created at ${head} but the attempt base is ${baseOid} — ` +
        'the worktree is left in place for inspection',
    );
  }
  return { dir, branch, baseOid, repoSlug: basename(repoDir) };
}

/** One `git worktree list --porcelain -z` record. */
export interface WorktreeEntry {
  /** Absolute path as git itself reports it. */
  path: string;
  /** Full HEAD oid when advertised. */
  head?: string;
  /** Fully qualified ref (e.g. `refs/heads/task/x`) when attached. */
  branch?: string;
}

/**
 * List registered worktrees of `repoDir`, parsing git's own `-z` porcelain
 * (ported from factory internal/worker/git.go `listGitWorktrees`). The paths
 * reported are git's own, which is what removal must use — and what
 * reconciliation matches on-disk directories against (`./reconcile.ts`).
 */
export async function listWorktrees(repoDir: string): Promise<WorktreeEntry[]> {
  const stdout = await runGit(['worktree', 'list', '--porcelain', '-z'], repoDir);
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;
  for (const token of stdout.split('\0')) {
    if (token.length === 0) {
      if (current !== undefined) {
        entries.push(current);
        current = undefined;
      }
      continue;
    }
    const space = token.indexOf(' ');
    const key = space === -1 ? token : token.slice(0, space);
    const value = space === -1 ? '' : token.slice(space + 1);
    if (key === 'worktree') {
      if (current !== undefined) {
        entries.push(current);
      }
      current = { path: value };
    } else if (current !== undefined && key === 'HEAD') {
      current.head = value;
    } else if (current !== undefined && key === 'branch') {
      current.branch = value;
    }
  }
  if (current !== undefined) {
    entries.push(current);
  }
  return entries;
}

/** realpathSync that degrades to the input when the path cannot be resolved. */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Compare two paths for equality the way git sees them: git reports real
 * paths (e.g. `/private/tmp` where the caller built `/tmp`), so both sides
 * are realpath-resolved before comparing.
 */
export function samePath(a: string, b: string): boolean {
  return realpathOrSelf(a) === realpathOrSelf(b) || resolve(realpathOrSelf(a)) === resolve(realpathOrSelf(b));
}

function retained(
  reason: 'dirty' | 'unpushed' | 'unproven' | 'outcome-not-done',
  detail: string,
): CleanupDecision {
  return { action: 'retained', reason, detail };
}

/**
 * Decide, fail-closed, whether a finished attempt's worktree may be removed —
 * and remove it when it may. This is the runner's highest-blast-radius
 * operation: a wrong removal permanently destroys uncommitted work, so the
 * port order (factory `automaticCleanupEligible` + `removeInspectedWorktree`,
 * pi-worktree's removal inventory) proves everything before deleting
 * anything:
 *
 * 1. Only outcome `done` may ever remove; `failed` and `needs_input` are
 *    retained (`outcome-not-done`) regardless of cleanliness — a human has
 *    not seen them yet (factory invariant 7).
 * 2. The path must exist **and** be a registered worktree of `repoDir`
 *    (matching registration path, branch `refs/heads/<wt.branch>`, and a
 *    full-OID HEAD). Anything unprovable is retained (`unproven`) and left
 *    on disk (factory invariant 6).
 * 3. The tree must be clean of tracked, staged, and untracked content
 *    (pi-worktree's inventory: `status --porcelain=v1 --untracked-files=all
 *    --ignored=matching --ignore-submodules=none`, run with
 *    `--no-optional-locks`). Blocking content retains with `dirty` and the
 *    detail lists the files. Ignored-only content (e.g. `node_modules/`)
 *    does **not** block removal but is listed in the returned decision.
 * 4. The branch must be provably pushed: its HEAD must be contained in some
 *    remote-tracking ref (factory `automaticCleanupEligible`:
 *    `for-each-ref --contains <head> refs/remotes`). An unchanged tree at
 *    the base commit qualifies because the base came from the remote.
 *    Otherwise retained with `unpushed`.
 * 5. Removal is `git worktree remove` with no `--force` (pi-worktree: removal
 *    never uses `--force`), run from `repoDir` against git's own reported
 *    path, then verified: the path must be gone and the registration gone.
 *    The branch is never deleted.
 *
 * A git failure during removal throws {@link GitError}; nothing is reported
 * removed that git did not actually remove.
 */
export async function retainOrRemove(
  repoDir: string,
  wt: Worktree,
  outcome: 'done' | 'failed' | 'needs_input',
): Promise<CleanupDecision> {
  if (outcome !== 'done') {
    return retained(
      'outcome-not-done',
      `outcome ${outcome} requires human inspection — worktree ${wt.dir} (branch ${wt.branch}) retained`,
    );
  }

  const entries = await listWorktrees(repoDir);
  const entry = entries.find((candidate) => samePath(candidate.path, wt.dir));
  if (!existsSync(wt.dir) || entry === undefined) {
    return retained(
      'unproven',
      `cannot prove worktree identity — ${wt.dir} ${existsSync(wt.dir) ? 'exists but is not registered under ' + repoDir : 'does not exist'}; nothing removed`,
    );
  }
  if (entry.branch !== `refs/heads/${wt.branch}`) {
    return retained(
      'unproven',
      `registered branch ${entry.branch ?? '(detached)'} does not match ${wt.branch} — refusing to remove ${wt.dir}`,
    );
  }
  if (entry.head === undefined || !FULL_OID_PATTERN.test(entry.head)) {
    return retained(
      'unproven',
      `registered worktree HEAD ${entry.head ?? '(missing)'} is not a full object id — refusing to remove ${wt.dir}`,
    );
  }

  const status = await runGit(
    [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignored=matching',
      '--ignore-submodules=none',
    ],
    wt.dir,
  );
  const ignoredPaths: string[] = [];
  const blocking: string[] = [];
  for (const line of status.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      continue;
    }
    const path = trimmed.slice(3);
    if (trimmed.startsWith('!! ')) {
      ignoredPaths.push(path);
    } else {
      blocking.push(path);
    }
  }
  if (blocking.length > 0) {
    return retained('dirty', `worktree ${wt.dir} is dirty: ${blocking.join(', ')}`);
  }

  const contains = await runGit(
    ['for-each-ref', '--format=%(refname)', '--contains', entry.head, 'refs/remotes'],
    wt.dir,
  );
  if (contains.trim().length === 0) {
    return retained(
      'unpushed',
      `branch ${wt.branch} contains commits not present on any remote-tracking ref (HEAD ${entry.head}) — worktree ${wt.dir} retained`,
    );
  }

  await runGit(['worktree', 'remove', entry.path], repoDir);
  if (existsSync(entry.path) || existsSync(wt.dir)) {
    throw new Error(`git reported worktree removal but ${wt.dir} still exists — refusing to report it removed`);
  }
  const after = await listWorktrees(repoDir);
  if (after.some((candidate) => samePath(candidate.path, wt.dir))) {
    throw new Error(
      `git reported worktree removal but the registration for ${wt.dir} remains — refusing to report it removed`,
    );
  }
  return { action: 'removed', ignoredPaths };
}
