import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  globalDirRefusalReason,
  isPlandeskSourceRepo,
  insertAgentsIndexBlock,
  insertFactorySentinelBlock,
  mergeHooksJson,
} from './connect-artifacts.js';
import { resolveAgents } from './connect.js';
import {
  HOOKS_SETTINGS_SNIPPET_JSON,
  SHIPPED_SKILL_NAMES,
  SHIPPED_TEMPLATES,
  agentsArtifactPath,
  skillSymlinkTarget,
} from './shipped-templates.js';
import { readTemplate } from './templates.js';

export class FactoryError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'FactoryError';
  }
}

export type FactoryInitOptions = {
  repoDir: string;
  print?: boolean;
  force?: boolean;
  /** Injectable for tests; defaults to os.homedir() inside the guard. */
  homeDir?: string;
};

export type FactoryArtifact = {
  path: string;
  content: string;
  action: 'create' | 'update' | 'skip';
  /** Set the executable bit (0o755) after writing — for the hook scripts. */
  executable?: boolean;
  /**
   * When set, write as a symlink to this relative target (same contract as
   * connect artifacts). Falls back to a content copy if symlinks are unavailable.
   */
  symlinkTarget?: string;
};

export type FactoryInitResult = {
  repoDir: string;
  artifacts: FactoryArtifact[];
};

export const FACTORY_DIR = '.agents/factory';
export const AGENTS_INDEX_REL = join('.agents', 'index.md');
export const SYNC_MANIFEST_REL = join('.agents', '.plandesk-sync.json');

/**
 * Ownership tier for a path under `.agents/`. Plan Desk is a tenant of the
 * shared `.agents/` convention — every write and every prune decision routes
 * through this classifier.
 *
 * - `owned` — Plan Desk may create-once and is the only tier prune may touch
 * - `shared_namespace` — append namespaced children only; never prune siblings
 * - `shared_file` — sentinel-block insert only; never whole-file write
 * - `foreign` — not ours; never write, never delete
 */
export type AgentsPathTier = 'owned' | 'shared_namespace' | 'shared_file' | 'foreign';

/** Classify a repo-relative path into an `.agents/` ownership tier. */
export function classifyAgentsPath(relPath: string): AgentsPathTier {
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (p === AGENTS_INDEX_REL || p === '.agents/index.md') {
    return 'shared_file';
  }
  if (p === SYNC_MANIFEST_REL || p === '.agents/.plandesk-sync.json') {
    return 'owned';
  }
  if (p === FACTORY_DIR || p === '.agents/factory' || p.startsWith(`${FACTORY_DIR}/`) || p.startsWith('.agents/factory/')) {
    return 'owned';
  }
  if (p.startsWith('.agents/skills/')) {
    return 'shared_namespace';
  }
  return 'foreign';
}

/** Template body for the Plan Desk block inside `.agents/index.md` (not the whole file). */
export function buildAgentsIndexMarkdown(): string {
  return readTemplate('index.md');
}

export function buildFactoryMarkdown(): string {
  return readTemplate('factory/factory.md');
}

export function buildExecutionMarkdown(): string {
  return readTemplate('factory/execution.md');
}

export function buildSlicingMarkdown(): string {
  return readTemplate('factory/slicing.md');
}

export function buildBriefMarkdown(): string {
  return readTemplate('factory/brief.md');
}

export function buildHeartbeatMarkdown(): string {
  return readTemplate('factory/heartbeat.md');
}

export const WORKER_NAMES = ['claude', 'codex', 'cursor', 'grok', 'opencode', 'pi'] as const;

export function buildWorkerMarkdown(name: string): string {
  return readTemplate(`factory/workers/${name}.md`);
}

export function buildProtocolMarkdown(): string {
  return readTemplate('factory/protocol.md');
}

export function buildRoutingMarkdown(): string {
  return readTemplate('factory/routing.md');
}

export function buildLanesMarkdown(): string {
  return readTemplate('factory/lanes.md');
}

export function buildWorkmanshipMarkdown(): string {
  return readTemplate('factory/workmanship.md');
}

export function buildExampleVerifierMarkdown(): string {
  return readTemplate('factory/verifiers/tests-pass.md');
}

export function buildRunsGitignore(): string {
  return readTemplate('factory/runs/.gitignore');
}

export function buildFactoryCommandMarkdown(): string {
  return `# Factory

@.agents/factory/factory.md

@.agents/factory/execution.md
`;
}

export function buildFactoryArtifacts(repoDir: string): FactoryArtifact[] {
  const artifacts: FactoryArtifact[] = [];
  const factoryDir = join(repoDir, FACTORY_DIR);

  // Authored policy files under the owned subtree: created once, then owned and
  // edited by the user. `authoredFactoryFiles` is the shipped-content source of
  // truth shared with `factory sync`; runs/.gitignore is static wiring, not
  // synced policy. Shared-file index.md is handled separately (sentinel block).
  const authored: Array<{ path: string; content: string }> = [
    ...authoredFactoryFiles(repoDir),
    { path: join(factoryDir, 'runs', '.gitignore'), content: buildRunsGitignore() },
  ];
  for (const file of authored) {
    artifacts.push({
      path: file.path,
      content: file.content,
      action: existsSync(file.path) ? 'skip' : 'create',
    });
  }

  // Shared file: `.agents/index.md` — sentinel-block insert only. Regenerated
  // every run (never skip) so Plan Desk's map cannot go stale when another tool
  // owns the rest of the file.
  const indexPath = join(repoDir, AGENTS_INDEX_REL);
  const existingIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  artifacts.push({
    path: indexPath,
    content: insertAgentsIndexBlock(existingIndex, buildAgentsIndexMarkdown()),
    action: existsSync(indexPath) ? 'update' : 'create',
  });

  // Always-on policy include: factory.md is POLICY — it must ride in default
  // context to gate behavior (a pointer the agent may not follow is not a
  // gate). Managed sentinel block, regenerated idempotently.
  const claudeMdPath = join(repoDir, 'CLAUDE.md');
  const existingClaudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';
  artifacts.push({
    path: claudeMdPath,
    content: insertFactorySentinelBlock(existingClaudeMd),
    action: existsSync(claudeMdPath) ? 'update' : 'create',
  });
  const agentsMdPath = join(repoDir, 'AGENTS.md');
  if (existsSync(agentsMdPath)) {
    artifacts.push({
      path: agentsMdPath,
      content: insertFactorySentinelBlock(readFileSync(agentsMdPath, 'utf8')),
      action: 'update',
    });
  }

  // Generated command adapters: regenerated on every run. An adapter we wrote
  // on a previous run counts as evidence the harness is in use — detection
  // must not flip just because the first run created sibling directories.
  const agents = resolveAgents(repoDir, 'detect');
  const claudeCommandPath = join(repoDir, '.claude', 'commands', 'factory.md');
  const codexCommandPath = join(repoDir, '.codex', 'commands', 'factory.md');
  if (agents.claude || existsSync(claudeCommandPath)) {
    artifacts.push({
      path: claudeCommandPath,
      content: buildFactoryCommandMarkdown(),
      action: existsSync(claudeCommandPath) ? 'update' : 'create',
    });
  }
  if (agents.codex || existsSync(codexCommandPath)) {
    artifacts.push({
      path: codexCommandPath,
      content: buildFactoryCommandMarkdown(),
      action: existsSync(codexCommandPath) ? 'update' : 'create',
    });
  }

  // Shipped artifacts: skills under .agents/skills/plandesk-*/SKILL.md and hooks
  // under .agents/factory/hooks/. Same skip-if-exists semantics as factory
  // policy files — a user's edited skill must never be clobbered on re-init.
  for (const template of SHIPPED_TEMPLATES) {
    const path = agentsArtifactPath(repoDir, template.relativePath);
    artifacts.push({
      path,
      content: template.content,
      action: existsSync(path) ? 'skip' : 'create',
      executable: template.executable,
    });
  }

  // .claude/skills/<name>/SKILL.md: symlink to the canonical file under
  // .agents/skills/ (Claude Code discovers only under .claude/skills/). Same
  // symlinkTarget + copy-fallback writer as connect. Refresh every run so a
  // prior plain-file copy is replaced by the link.
  for (const name of SHIPPED_SKILL_NAMES) {
    const canonicalPath = agentsArtifactPath(repoDir, `skills/${name}/SKILL.md`);
    const adapterPath = join(repoDir, '.claude', 'skills', name, 'SKILL.md');
    const content = existsSync(canonicalPath)
      ? readFileSync(canonicalPath, 'utf8')
      : readTemplate(`skills/${name}/SKILL.md`);
    artifacts.push({
      path: adapterPath,
      content,
      action: lstatSync(adapterPath, { throwIfNoEntry: false }) === undefined ? 'create' : 'update',
      symlinkTarget: skillSymlinkTarget(name),
    });
  }

  // Hooks wiring (F1): merge the SessionStart/Stop/PreCompact block
  // into .claude/settings.json additively — never clobbers a user's existing
  // hooks for other events, and never duplicates the Plan Desk entries on
  // rerun (see mergeHooksJson).
  const settingsJsonPath = join(repoDir, '.claude', 'settings.json');
  const existingSettingsJson = existsSync(settingsJsonPath)
    ? readFileSync(settingsJsonPath, 'utf8')
    : undefined;
  artifacts.push({
    path: settingsJsonPath,
    content: mergeHooksJson(existingSettingsJson, HOOKS_SETTINGS_SNIPPET_JSON),
    action: existingSettingsJson !== undefined ? 'update' : 'create',
  });

  return artifacts;
}

function writeFactoryArtifacts(artifacts: FactoryArtifact[]): void {
  for (const artifact of artifacts) {
    if (artifact.action === 'skip') {
      continue;
    }
    mkdirSync(dirname(artifact.path), { recursive: true });
    if (artifact.symlinkTarget !== undefined) {
      // Same contract as connect writeArtifacts: try a symlink, fall back to a
      // content copy when the platform refuses (unprivileged Windows).
      rmSync(artifact.path, { force: true });
      try {
        symlinkSync(artifact.symlinkTarget, artifact.path);
      } catch {
        writeFileSync(artifact.path, artifact.content, 'utf8');
      }
      continue;
    }
    writeFileSync(artifact.path, artifact.content, 'utf8');
    if (artifact.executable === true) {
      chmodSync(artifact.path, 0o755);
    }
  }
}

type SyncableFile = { path: string; content: string; executable?: boolean };

// The create-once authored files `factory sync` tracks: owned factory policy
// docs plus shared-namespace skill/hook sources. Generated files (the
// index.md / CLAUDE.md sentinel blocks, command/skill adapters, settings.json)
// already refresh on every `factory init`, so sync refreshes those too but they
// never "conflict". This is the shipped source of truth — `buildFactoryArtifacts`
// scaffolds from the same list. index.md is deliberately absent: it is a
// shared-file sentinel block, not a whole-file artifact.
export function authoredFactoryFiles(repoDir: string): SyncableFile[] {
  const factoryDir = join(repoDir, FACTORY_DIR);
  return [
    { path: join(factoryDir, 'factory.md'), content: buildFactoryMarkdown() },
    { path: join(factoryDir, 'execution.md'), content: buildExecutionMarkdown() },
    { path: join(factoryDir, 'slicing.md'), content: buildSlicingMarkdown() },
    { path: join(factoryDir, 'brief.md'), content: buildBriefMarkdown() },
    { path: join(factoryDir, 'heartbeat.md'), content: buildHeartbeatMarkdown() },
    { path: join(factoryDir, 'protocol.md'), content: buildProtocolMarkdown() },
    { path: join(factoryDir, 'routing.md'), content: buildRoutingMarkdown() },
    { path: join(factoryDir, 'lanes.md'), content: buildLanesMarkdown() },
    { path: join(factoryDir, 'workmanship.md'), content: buildWorkmanshipMarkdown() },
    { path: join(factoryDir, 'verifiers', 'tests-pass.md'), content: buildExampleVerifierMarkdown() },
    ...WORKER_NAMES.map((name) => ({
      path: join(factoryDir, 'workers', `${name}.md`),
      content: buildWorkerMarkdown(name),
    })),
  ];
}

function syncableAuthoredFiles(repoDir: string): SyncableFile[] {
  return [
    ...authoredFactoryFiles(repoDir),
    ...SHIPPED_TEMPLATES.map((template) => ({
      path: agentsArtifactPath(repoDir, template.relativePath),
      content: template.content,
      executable: template.executable,
    })),
  ];
}

// Sync manifest: relative-path → sha256 of the shipped content the CLI last wrote.
// It lets sync tell "you edited this" (on-disk hash ≠ manifest) from "just stale"
// (on-disk hash == manifest, shipped changed) so a safe update never clobbers edits.
// Derived state only — keys naming files the CLI no longer ships are dropped on
// every rewrite (no rename-migration table).

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function syncManifestPath(repoDir: string): string {
  return join(repoDir, SYNC_MANIFEST_REL);
}

export function readSyncManifest(repoDir: string): Record<string, string> {
  const path = syncManifestPath(repoDir);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'files' in parsed &&
      typeof parsed.files === 'object' &&
      parsed.files !== null
    ) {
      return { ...(parsed as { files: Record<string, string> }).files };
    }
  } catch {
    // A corrupt manifest is treated as absent — sync degrades to conservative.
  }
  return {};
}

function writeSyncManifest(repoDir: string, files: Record<string, string>): void {
  const path = syncManifestPath(repoDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, files }, null, 2)}\n`, 'utf8');
}

/** Repo-relative paths the CLI currently declares as syncable authored files. */
export function declaredSyncRelPaths(repoDir: string): Set<string> {
  return new Set(syncableAuthoredFiles(repoDir).map((file) => relative(repoDir, file.path)));
}

/**
 * Drop manifest keys the CLI no longer ships. Keeps prior hashes for still-declared
 * files (including user-edited ones) so conflict detection stays accurate.
 */
export function pruneUnknownManifestKeys(
  manifest: Record<string, string>,
  declared: Set<string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [relPath, hash] of Object.entries(manifest)) {
    if (declared.has(relPath)) {
      next[relPath] = hash;
    }
  }
  return next;
}

/**
 * Files prune may delete: keys present in the manifest, absent from the declared
 * template set, and classified `owned`. Never enumerates disk under `.agents/`.
 * Only deletes when on-disk content still matches the last-written hash (user
 * edits of a removed path are left alone).
 */
export function planOwnedPrune(repoDir: string): string[] {
  const manifest = readSyncManifest(repoDir);
  const declared = declaredSyncRelPaths(repoDir);
  const toDelete: string[] = [];
  for (const [relPath, hash] of Object.entries(manifest)) {
    if (declared.has(relPath)) {
      continue;
    }
    if (classifyAgentsPath(relPath) !== 'owned') {
      continue;
    }
    const abs = join(repoDir, relPath);
    if (!existsSync(abs)) {
      continue;
    }
    try {
      if (sha256(readFileSync(abs, 'utf8')) !== hash) {
        continue;
      }
    } catch {
      continue;
    }
    toDelete.push(relPath);
  }
  return toDelete;
}

// Record shipped-content hashes for every authored file currently identical to
// what the CLI ships — i.e. files it just wrote or that are already in sync.
// Unknown keys (files no longer shipped) are dropped. A file the user edited
// keeps its prior hash when still declared so sync conflict detection works.
function recordInSyncManifest(repoDir: string): void {
  const prev = readSyncManifest(repoDir);
  const declared = declaredSyncRelPaths(repoDir);
  const next: Record<string, string> = {};
  for (const file of syncableAuthoredFiles(repoDir)) {
    const rel = relative(repoDir, file.path);
    if (existsSync(file.path) && readFileSync(file.path, 'utf8') === file.content) {
      next[rel] = sha256(file.content);
    } else {
      const previousHash = prev[rel];
      if (previousHash !== undefined) {
        next[rel] = previousHash;
      }
    }
  }
  // Explicitly re-apply declared filter so any non-declared key is gone.
  writeSyncManifest(repoDir, pruneUnknownManifestKeys(next, declared));
}

export type FactorySyncStatus = 'up_to_date' | 'create' | 'safe_update' | 'conflict';

export type FactorySyncEntry = {
  path: string;
  relPath: string;
  status: FactorySyncStatus;
  shipped: string;
  onDisk?: string;
  executable?: boolean;
};

export type FactorySyncOptions = {
  repoDir: string;
  write?: boolean;
  force?: boolean;
  /** Delete owned files the CLI once shipped but no longer declares (hard-guarded). */
  prune?: boolean;
  homeDir?: string;
};

export type FactorySyncResult = {
  repoDir: string;
  entries: FactorySyncEntry[];
  applied: boolean;
  /** Owned-subtree paths removed when `--prune` applied. */
  pruned: string[];
  /** Per-agent skill links created because they were missing. */
  linked: string[];
};

export function planFactorySync(repoDir: string): FactorySyncEntry[] {
  const manifest = readSyncManifest(repoDir);
  const entries: FactorySyncEntry[] = [];
  for (const file of syncableAuthoredFiles(repoDir)) {
    const relPath = relative(repoDir, file.path);
    if (!existsSync(file.path)) {
      entries.push({ path: file.path, relPath, status: 'create', shipped: file.content, executable: file.executable });
      continue;
    }
    const onDisk = readFileSync(file.path, 'utf8');
    if (onDisk === file.content) {
      entries.push({ path: file.path, relPath, status: 'up_to_date', shipped: file.content, onDisk, executable: file.executable });
      continue;
    }
    // Differs from shipped. If the manifest proves it's unmodified since we last
    // wrote it, the difference is just staleness → safe to update. Otherwise the
    // user (or an unknown history) changed it → conflict, protected unless --force.
    const base = manifest[relPath];
    const unmodified = base !== undefined && base === sha256(onDisk);
    entries.push({
      path: file.path,
      relPath,
      status: unmodified ? 'safe_update' : 'conflict',
      shipped: file.content,
      onDisk,
      executable: file.executable,
    });
  }
  return entries;
}

export function runFactorySync(options: FactorySyncOptions): FactorySyncResult {
  const repoDir = resolve(options.repoDir);
  const refusal = globalDirRefusalReason(repoDir, options.homeDir);
  if (refusal !== undefined && options.force !== true) {
    throw new FactoryError(
      `Refusing to sync in ${refusal}: agent config here leaks into every project on this machine.`,
    );
  }
  if (isPlandeskSourceRepo(repoDir)) {
    throw new FactoryError(
      `Refusing to sync in Plan Desk's own source tree: .agents/ here is the source that dist/templates is built from, ` +
        `not a scaffold. Syncing writes the scaffolded shape back over the template — a run here once wrapped ` +
        `.agents/index.md in the sentinel markers the CLI inserts, so every consumer would have received two. ` +
        `Edit .agents/ directly and rebuild.`,
    );
  }

  const entries = planFactorySync(repoDir);
  const applyUpdates = options.write === true || options.force === true;
  const applyPrune = options.prune === true;
  if (!applyUpdates && !applyPrune) {
    return { repoDir, entries, applied: false, pruned: [], linked: [] };
  }

  let manifest = readSyncManifest(repoDir);
  if (applyUpdates) {
    for (const entry of entries) {
      const write =
        entry.status === 'create' ||
        entry.status === 'safe_update' ||
        (entry.status === 'conflict' && options.force === true);
      if (write) {
        mkdirSync(dirname(entry.path), { recursive: true });
        writeFileSync(entry.path, entry.shipped, 'utf8');
        if (entry.executable === true) {
          chmodSync(entry.path, 0o755);
        }
      }
      if (write || entry.status === 'up_to_date') {
        manifest[entry.relPath] = sha256(entry.shipped);
      }
    }
  }

  // File prune: only paths the templates no longer declare, and only when
  // classifyAgentsPath says `owned`. Iterate the manifest (what we wrote), never
  // enumerate `.agents/` on disk.
  const pruned: string[] = [];
  if (applyPrune) {
    for (const relPath of planOwnedPrune(repoDir)) {
      rmSync(join(repoDir, relPath), { force: true });
      pruned.push(relPath);
    }
  }

  // Manifest is derived state: drop keys for files the CLI no longer ships.
  const declared = declaredSyncRelPaths(repoDir);
  if (applyUpdates) {
    // Re-read declared hashes after writes; keep conflict bases for edited files.
    const next: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.status === 'up_to_date' || entry.status === 'create' || entry.status === 'safe_update') {
        next[entry.relPath] = sha256(entry.shipped);
      } else {
        if (options.force === true) {
          next[entry.relPath] = sha256(entry.shipped);
        } else {
          const previousHash = manifest[entry.relPath];
          if (previousHash !== undefined) {
            next[entry.relPath] = previousHash;
          }
        }
      }
    }
    manifest = pruneUnknownManifestKeys(next, declared);
  } else {
    // Prune-only: drop unknown keys, leave declared entries as they were.
    manifest = pruneUnknownManifestKeys(manifest, declared);
  }
  writeSyncManifest(repoDir, manifest);

  // Now that authored sources are current, refresh the generated files that
  // depend on them (index/CLAUDE sentinels, skill symlinks, command adapters).
  //
  // `create` belongs here as much as `update`. Filtering to `update` alone meant
  // a generated file that did not exist yet was never made — so a skill shipped
  // after a repo was initialised landed in `.agents/skills/` and stayed
  // unreachable, because the agent reads `.claude/skills/`. Observed on eight
  // repos after plandesk-foreman shipped: present, committed, and un-invocable.
  // `skip` is still excluded — that is the create-once authored policy.
  const linked: string[] = [];
  if (applyUpdates) {
    const generated = buildFactoryArtifacts(repoDir).filter(
      (artifact) => artifact.action !== 'skip',
    );
    for (const artifact of generated) {
      if (artifact.action === 'create' && artifact.symlinkTarget !== undefined) {
        linked.push(relative(repoDir, artifact.path));
      }
    }
    writeFactoryArtifacts(generated);
  }

  return { repoDir, entries, applied: true, pruned, linked };
}

export function formatFactorySyncSummary(result: FactorySyncResult): string {
  const byStatus = (s: FactorySyncStatus) => result.entries.filter((e) => e.status === s);
  const upToDate = byStatus('up_to_date');
  const created = byStatus('create');
  const safe = byStatus('safe_update');
  const conflicts = byStatus('conflict');
  const lines: string[] = [];

  if (result.applied) {
    lines.push('Factory sync applied.');
    if (created.length > 0)
      lines.push(`created (${String(created.length)}): ${created.map((e) => e.relPath).join(', ')}`);
    if (safe.length > 0)
      lines.push(`updated (${String(safe.length)}): ${safe.map((e) => e.relPath).join(', ')}`);
    if (result.pruned.length > 0) {
      lines.push(`pruned (${String(result.pruned.length)}): ${result.pruned.join(', ')}`);
    }
    if (result.linked.length > 0) {
      lines.push(
        `linked (${String(result.linked.length)}): ${result.linked.join(', ')} — new skills were not reachable by your agent until now`,
      );
    }
    lines.push(`up to date (${String(upToDate.length)}).`);
    if (conflicts.length > 0) {
      lines.push(
        `customized — kept your version (${String(conflicts.length)}): ${conflicts.map((e) => e.relPath).join(', ')}`,
      );
      lines.push(
        'These differ from the shipped version AND from what the CLI last wrote — your edits. Review each with `git diff`, or run `plandesk factory sync --force` to overwrite them with the shipped version.',
      );
    }
    lines.push('Review everything with `git diff .agents/` before committing.');
    return `${lines.join('\n')}\n`;
  }

  // Dry-run (default): report the plan, write nothing.
  lines.push(`plandesk factory sync — plan for ${result.repoDir}`);
  lines.push(`up to date: ${String(upToDate.length)}`);
  if (created.length > 0)
    lines.push(
      `would create (${String(created.length)}): ${created.map((e) => e.relPath).join(', ')}`,
    );
  if (safe.length > 0)
    lines.push(
      `would update — unmodified, safe (${String(safe.length)}): ${safe.map((e) => e.relPath).join(', ')}`,
    );
  if (conflicts.length > 0)
    lines.push(
      `customized — would keep your version (${String(conflicts.length)}): ${conflicts.map((e) => e.relPath).join(', ')}`,
    );
  lines.push('');
  if (created.length + safe.length === 0 && conflicts.length === 0) {
    lines.push('Everything is up to date.');
  } else {
    lines.push('Run `plandesk factory sync --write` to apply creates + safe updates (customized files are kept).');
    if (conflicts.length > 0) {
      lines.push('Add `--force` to also overwrite customized files with the shipped version.');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function runFactoryInit(options: FactoryInitOptions): FactoryInitResult {
  const repoDir = resolve(options.repoDir);

  const refusal = globalDirRefusalReason(repoDir, options.homeDir);
  if (refusal !== undefined && options.force !== true) {
    throw new FactoryError(
      `Refusing to scaffold in ${refusal}: agent config written here leaks into every project on this machine. ` +
        `Run from a project repository (or pass --force if you really mean it).`,
    );
  }
  if (isPlandeskSourceRepo(repoDir)) {
    throw new FactoryError(
      `Refusing to scaffold in Plan Desk's own source tree: .agents/ here is the source that dist/templates is built ` +
        `from, not a scaffold. Edit .agents/ directly and rebuild.`,
    );
  }

  const artifacts = buildFactoryArtifacts(repoDir);

  if (options.print !== true) {
    writeFactoryArtifacts(artifacts);
    // Seed the sync manifest so a later `factory sync` can tell edits from
    // staleness. Only records files now identical to shipped (never an edit).
    recordInSyncManifest(repoDir);
  }

  return { repoDir, artifacts };
}

export function formatFactoryInitSummary(result: FactoryInitResult): string {
  const lines: string[] = [];
  lines.push(`Factory workspace ready at ${join(result.repoDir, '.agents')}`);
  for (const artifact of result.artifacts) {
    lines.push(`${artifact.action}: ${artifact.path}`);
  }
  lines.push(
    'Edit .agents/factory/ (factory.md, lanes.md, workers/*.md) to fit this repo — they are yours now (skip = kept your version).',
  );
  return `${lines.join('\n')}\n`;
}

export function formatFactoryInitPrint(result: FactoryInitResult): string {
  const lines: string[] = [];
  lines.push('# plandesk factory init --print');
  lines.push(`repo: ${result.repoDir}`);
  lines.push('');
  for (const artifact of result.artifacts) {
    if (artifact.symlinkTarget !== undefined) {
      lines.push(
        `--- ${artifact.action.toUpperCase()} ${artifact.path} -> ${artifact.symlinkTarget}`,
      );
      continue;
    }
    lines.push(`--- ${artifact.action.toUpperCase()} ${artifact.path}`);
    if (artifact.action !== 'skip') {
      lines.push(artifact.content);
    }
  }
  return `${lines.join('\n')}\n`;
}
