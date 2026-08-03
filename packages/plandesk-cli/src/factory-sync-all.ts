import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createDb,
  isValidRegisteredRepoRoot,
  listProjects,
  DEFAULT_ORG_ID,
  type Db,
} from '@plandesk/db';
import { resolveDataDir, workspaceDbPath } from './args.js';
import { resolveRegisteredRepoRoot } from './repo-root.js';
import { backfillRepoFolderPathFromCwd } from './folder-path-backfill.js';
import {
  FactoryError,
  runFactorySync,
  type FactorySyncResult,
  type FactorySyncStatus,
} from './factory.js';

/**
 * Sweep every repo this board knows about, instead of one `--repo` at a time.
 *
 * The board is the right registry: a project's `folder_path` is the repo root
 * that project is bound to, so "every registered root" is a fact the board
 * already holds rather than a filesystem guess. What it is NOT is automatically
 * populated — `folder_path` is written by `connect` and by `serve` running
 * inside a repo, so a board whose projects were bound before that shipped has
 * an empty registry and a sweep over it is a silent no-op.
 *
 * `--scan` exists for exactly that: discover repos under a directory, register
 * each one's root, and leave the registry correct so later `--all` runs need no
 * scan. Discovery bootstraps the registry; it does not replace it.
 */

/** A repo the sweep touched, and what happened to it. */
export type FactorySweepOutcome =
  | { root: string; status: 'synced'; result: FactorySyncResult }
  | { root: string; status: 'skipped'; reason: string };

export type FactorySyncAllResult = {
  /** Registered roots considered, after dedupe. */
  considered: number;
  /** Roots newly registered by `--scan` during this run. */
  registered: string[];
  outcomes: FactorySweepOutcome[];
};

export type FactorySyncAllOptions = {
  write?: boolean;
  force?: boolean;
  prune?: boolean;
  /** Directory to discover `.plandesk` repos under, registering each root. */
  scan?: string;
  dataDir?: string;
  homeDir?: string;
};

const SCAN_MAX_DEPTH = 6;
const SCAN_SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'target']);

/**
 * Directories containing `.plandesk/config.json` beneath `root`.
 *
 * Depth-bounded and skips dependency trees: an unbounded walk of a home
 * directory spends most of its time inside `node_modules`, and a checkout
 * vendored under one is not a project anybody wants swept.
 */
export function discoverPlandeskRepos(root: string, maxDepth = SCAN_MAX_DEPTH): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not a failure of the sweep
    }
    if (existsSync(join(dir, '.plandesk', 'config.json'))) {
      found.push(dir);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SCAN_SKIP.has(entry.name)) {
        continue;
      }
      if (entry.name.startsWith('.') && entry.name !== '.plandesk') {
        continue;
      }
      if (entry.name === '.plandesk') {
        continue;
      }
      walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(resolve(root), 0);
  // Normalise the same way the registry does. `folder_path` is stored
  // realpath-resolved, so an un-resolved discovery path is a *different string*
  // for the same repo — on macOS every /tmp path resolves to /private/tmp, and a
  // repo reached through any symlink hits this too. Without it the sweep visits
  // one repo twice, once per spelling.
  const normalised = found.map((dir) => {
    try {
      return resolveRegisteredRepoRoot(dir);
    } catch {
      return dir;
    }
  });
  return [...new Set(normalised)].sort();
}

/** Distinct, still-present repo roots registered on this board. */
export async function resolveRegisteredRepoRoots(db: Db): Promise<string[]> {
  const projects = await listProjects(db, DEFAULT_ORG_ID);
  const roots = new Set<string>();
  for (const project of projects) {
    const path = project.folderPath;
    if (path !== null && isValidRegisteredRepoRoot(path)) {
      roots.add(path);
    }
  }
  return [...roots].sort();
}

export async function runFactorySyncAll(
  options: FactorySyncAllOptions = {},
): Promise<FactorySyncAllResult> {
  const dataDir = resolveDataDir(options.dataDir);
  const dbPath = workspaceDbPath(dataDir);
  if (!existsSync(dbPath)) {
    throw new FactoryError(
      `No board at ${dbPath}. Run \`plandesk init\` first — \`--all\` sweeps the repos this board has registered.`,
    );
  }
  const db = await createDb(dbPath);

  // Discovery is read-only; only `--write` records a root on the board. A dry
  // run that quietly mutated the registry would be a dry run in name only — so
  // discovered repos are still swept-as-planned here, they are just not
  // persisted until the user asks for the write.
  const registered: string[] = [];
  const discovered = options.scan === undefined ? [] : discoverPlandeskRepos(options.scan);
  if (options.write === true) {
    for (const repo of discovered) {
      const outcome = await backfillRepoFolderPathFromCwd(db, repo);
      if (outcome?.status === 'set') {
        registered.push(outcome.folderPath);
      }
    }
  }

  const roots = [...new Set([...(await resolveRegisteredRepoRoots(db)), ...discovered])].sort();
  const outcomes: FactorySweepOutcome[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      outcomes.push({ root, status: 'skipped', reason: 'no longer on disk' });
      continue;
    }
    try {
      // One bad root must not end the sweep: `runFactorySync` legitimately
      // refuses Plan Desk's own source tree and global config dirs, and those
      // refusals are correct outcomes here rather than sweep failures.
      const result = runFactorySync({
        repoDir: root,
        write: options.write,
        force: options.force,
        prune: options.prune,
        homeDir: options.homeDir,
      });
      outcomes.push({ root, status: 'synced', result });
    } catch (err) {
      const reason = err instanceof FactoryError ? err.message : String(err);
      outcomes.push({ root, status: 'skipped', reason });
    }
  }

  return { considered: roots.length, registered, outcomes };
}

function countEntries(result: FactorySyncResult, status: FactorySyncStatus): number {
  return result.entries.filter((entry) => entry.status === status).length;
}

export function formatFactorySyncAllSummary(
  result: FactorySyncAllResult,
  options: { write?: boolean; scanned?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`plandesk factory sync --all — ${String(result.considered)} registered repo(s)`);

  if (result.registered.length > 0) {
    lines.push(`  registered by --scan: ${String(result.registered.length)}`);
  }

  if (result.considered === 0) {
    lines.push('');
    lines.push('  No project on this board has a registered repo root, so there is nothing to');
    lines.push('  sweep. A root is recorded by `plandesk connect` in a repo, or by `plandesk');
    lines.push('  serve` running inside one — boards bound before that shipped have none.');
    lines.push('');
    lines.push('  Register them in one pass:');
    lines.push('    plandesk factory sync --all --scan ~/  # add --write to apply');
    return `${lines.join('\n')}\n`;
  }

  let synced = 0;
  let skipped = 0;
  let created = 0;
  let updated = 0;
  let customized = 0;

  for (const outcome of result.outcomes) {
    if (outcome.status === 'skipped') {
      skipped += 1;
      lines.push(`  skipped  ${outcome.root} — ${outcome.reason}`);
      continue;
    }
    synced += 1;
    const c = countEntries(outcome.result, 'create');
    const u = countEntries(outcome.result, 'safe_update');
    const k = countEntries(outcome.result, 'conflict');
    created += c;
    updated += u;
    customized += k;
    const parts = [`created ${String(c)}`, `updated ${String(u)}`];
    if (k > 0) {
      parts.push(`kept ${String(k)} customized`);
    }
    lines.push(`  ${outcome.root} — ${parts.join(', ')}`);
  }

  lines.push('');
  lines.push(
    `  ${String(synced)} synced, ${String(skipped)} skipped · ${String(created)} created, ` +
      `${String(updated)} updated, ${String(customized)} customized files kept`,
  );
  if (options.write !== true) {
    lines.push('');
    lines.push('  Dry run. Re-run with --write to apply (customized files are always kept).');
  }
  return `${lines.join('\n')}\n`;
}
