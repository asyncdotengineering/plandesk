import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  globalDirRefusalReason,
  insertFactorySentinelBlock,
  mergeCuratorHooksJson,
} from './connect-artifacts.js';
import { resolveAgents } from './connect.js';
import {
  CURATOR_DIR,
  CURATOR_HOOKS_SETTINGS_SNIPPET_JSON,
  CURATOR_SKILLS,
  CURATOR_TEMPLATES,
  buildCuratorSkillAdapter,
} from './curator-templates.js';
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
  /** Set the executable bit (0o755) after writing — for the curator hook scripts. */
  executable?: boolean;
};

export type FactoryInitResult = {
  repoDir: string;
  artifacts: FactoryArtifact[];
};

export const FACTORY_DIR = '.agents/factory';

export function buildAgentsIndexMarkdown(): string {
  return readTemplate('index.md');
}

export function buildFactoryMarkdown(): string {
  return readTemplate('factory/factory.md');
}

export function buildAutonomousStandMarkdown(): string {
  return readTemplate('factory/autonomous-stand.md');
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

export function buildExampleVerifierMarkdown(): string {
  return readTemplate('factory/verifiers/tests-pass.md');
}

export function buildRunsGitignore(): string {
  return readTemplate('factory/runs/.gitignore');
}

export function buildWorkflowMarkdown(): string {
  return readTemplate('factory/workflow.md');
}

export function buildFactoryCommandMarkdown(): string {
  return `# Factory

@.agents/factory/workflow.md

@.agents/factory/factory.md

@.agents/factory/autonomous-stand.md
`;
}

export function buildFactoryArtifacts(repoDir: string): FactoryArtifact[] {
  const artifacts: FactoryArtifact[] = [];
  const factoryDir = join(repoDir, FACTORY_DIR);

  // Authored policy files: created once, then owned and edited by the user.
  // `authoredFactoryFiles` is the shipped-content source of truth shared with
  // `factory sync`; runs/.gitignore is static wiring, not synced policy.
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

  // Always-on policy include: workflow.md + factory.md are POLICY — they must
  // ride in default context to gate behavior (a pointer the agent may not
  // follow is not a gate). Managed sentinel block, regenerated idempotently.
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

  // Curator artifacts (Plan-Desk-Curator RFC): authored policy, same
  // skip-if-exists semantics as the factory files above — a user's edited
  // triage.md must never be clobbered by a second `factory init` run.
  const curatorDir = join(repoDir, CURATOR_DIR);
  for (const template of CURATOR_TEMPLATES) {
    const path = join(curatorDir, template.relativePath);
    artifacts.push({
      path,
      content: template.content,
      action: existsSync(path) ? 'skip' : 'create',
      executable: template.executable,
    });
  }

  // .claude/skills adapters (F5): the curator skills live canonically under
  // .agents/curator/ (harness-neutral, path-referenced), but Claude Code only
  // auto-discovers skills at .claude/skills/<name>/SKILL.md carrying name+description
  // frontmatter. Generate a discoverable adapter per skill — regenerated each run
  // ('update') so it never drifts, sourced from the on-disk .agents/ file when the
  // user has one (else the shipped constant).
  for (const skill of CURATOR_SKILLS) {
    const sourcePath = join(curatorDir, `${skill.slug}.md`);
    const source = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : skill.source;
    const adapterPath = join(repoDir, '.claude', 'skills', skill.name, 'SKILL.md');
    artifacts.push({
      path: adapterPath,
      content: buildCuratorSkillAdapter(source, skill.name, skill.description),
      action: existsSync(adapterPath) ? 'update' : 'create',
    });
  }

  // Curator hooks wiring (F1): merge the SessionStart/Stop/PreCompact block
  // into .claude/settings.json additively — never clobbers a user's existing
  // hooks for other events, and never duplicates the curator entries on
  // rerun (see mergeCuratorHooksJson).
  const settingsJsonPath = join(repoDir, '.claude', 'settings.json');
  const existingSettingsJson = existsSync(settingsJsonPath)
    ? readFileSync(settingsJsonPath, 'utf8')
    : undefined;
  artifacts.push({
    path: settingsJsonPath,
    content: mergeCuratorHooksJson(existingSettingsJson, CURATOR_HOOKS_SETTINGS_SNIPPET_JSON),
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
    writeFileSync(artifact.path, artifact.content, 'utf8');
    if (artifact.executable === true) {
      chmodSync(artifact.path, 0o755);
    }
  }
}

type SyncableFile = { path: string; content: string; executable?: boolean };

// The create-once authored files `factory sync` tracks: the factory policy docs
// plus the curator sources. Generated files (the CLAUDE.md sentinel block, the
// command/skill adapters, settings.json) already refresh on every `factory init`,
// so sync refreshes those too but they never "conflict". This is the shipped
// source of truth — `buildFactoryArtifacts` scaffolds from the same list.
export function authoredFactoryFiles(repoDir: string): SyncableFile[] {
  const factoryDir = join(repoDir, FACTORY_DIR);
  return [
    { path: join(repoDir, '.agents', 'index.md'), content: buildAgentsIndexMarkdown() },
    { path: join(factoryDir, 'workflow.md'), content: buildWorkflowMarkdown() },
    { path: join(factoryDir, 'factory.md'), content: buildFactoryMarkdown() },
    { path: join(factoryDir, 'autonomous-stand.md'), content: buildAutonomousStandMarkdown() },
    { path: join(factoryDir, 'protocol.md'), content: buildProtocolMarkdown() },
    { path: join(factoryDir, 'routing.md'), content: buildRoutingMarkdown() },
    { path: join(factoryDir, 'lanes.md'), content: buildLanesMarkdown() },
    { path: join(factoryDir, 'verifiers', 'tests-pass.md'), content: buildExampleVerifierMarkdown() },
    ...WORKER_NAMES.map((name) => ({
      path: join(factoryDir, 'workers', `${name}.md`),
      content: buildWorkerMarkdown(name),
    })),
  ];
}

function syncableAuthoredFiles(repoDir: string): SyncableFile[] {
  const curatorDir = join(repoDir, CURATOR_DIR);
  return [
    ...authoredFactoryFiles(repoDir),
    ...CURATOR_TEMPLATES.map((template) => ({
      path: join(curatorDir, template.relativePath),
      content: template.content,
      executable: template.executable,
    })),
  ];
}

// Sync manifest: relative-path → sha256 of the shipped content the CLI last wrote.
// It lets sync tell "you edited this" (on-disk hash ≠ manifest) from "just stale"
// (on-disk hash == manifest, shipped changed) so a safe update never clobbers edits.
const SYNC_MANIFEST_REL = join('.agents', '.plandesk-sync.json');

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
      typeof (parsed as { files: unknown }).files === 'object'
    ) {
      return (parsed as { files: Record<string, string> }).files;
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

// Record shipped-content hashes for every authored file currently identical to
// what the CLI ships — i.e. files it just wrote or that are already in sync. A
// file the user edited (on-disk ≠ shipped) is deliberately left out so sync
// keeps protecting it.
function recordInSyncManifest(repoDir: string): void {
  const manifest = readSyncManifest(repoDir);
  for (const file of syncableAuthoredFiles(repoDir)) {
    if (existsSync(file.path) && readFileSync(file.path, 'utf8') === file.content) {
      manifest[relative(repoDir, file.path)] = sha256(file.content);
    }
  }
  writeSyncManifest(repoDir, manifest);
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
  homeDir?: string;
};

export type FactorySyncResult = {
  repoDir: string;
  entries: FactorySyncEntry[];
  applied: boolean;
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

  const entries = planFactorySync(repoDir);
  const apply = options.write === true || options.force === true;
  if (!apply) {
    return { repoDir, entries, applied: false };
  }

  const manifest = readSyncManifest(repoDir);
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
  writeSyncManifest(repoDir, manifest);

  // Now that authored sources are current, refresh the generated files that
  // depend on them (the sentinel block and the skill/command adapters).
  for (const artifact of buildFactoryArtifacts(repoDir)) {
    if (artifact.action !== 'update') {
      continue;
    }
    mkdirSync(dirname(artifact.path), { recursive: true });
    writeFileSync(artifact.path, artifact.content, 'utf8');
    if (artifact.executable === true) {
      chmodSync(artifact.path, 0o755);
    }
  }

  return { repoDir, entries, applied: true };
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
    if (created.length > 0) lines.push(`created (${created.length}): ${created.map((e) => e.relPath).join(', ')}`);
    if (safe.length > 0) lines.push(`updated (${safe.length}): ${safe.map((e) => e.relPath).join(', ')}`);
    lines.push(`up to date (${upToDate.length}).`);
    if (conflicts.length > 0) {
      lines.push(
        `customized — kept your version (${conflicts.length}): ${conflicts.map((e) => e.relPath).join(', ')}`,
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
  lines.push(`up to date: ${upToDate.length}`);
  if (created.length > 0) lines.push(`would create (${created.length}): ${created.map((e) => e.relPath).join(', ')}`);
  if (safe.length > 0)
    lines.push(`would update — unmodified, safe (${safe.length}): ${safe.map((e) => e.relPath).join(', ')}`);
  if (conflicts.length > 0)
    lines.push(
      `customized — would keep your version (${conflicts.length}): ${conflicts.map((e) => e.relPath).join(', ')}`,
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
    lines.push(`--- ${artifact.action.toUpperCase()} ${artifact.path}`);
    if (artifact.action !== 'skip') {
      lines.push(artifact.content);
    }
  }
  return `${lines.join('\n')}\n`;
}
