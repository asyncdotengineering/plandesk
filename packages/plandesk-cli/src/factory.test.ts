import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENTS_INDEX_SENTINEL_END,
  AGENTS_INDEX_SENTINEL_START,
  globalDirRefusalReason,
} from './connect-artifacts.js';
import {
  SHIPPED_SKILL_NAMES,
  SHIPPED_TEMPLATES,
  agentsArtifactPath,
  skillSymlinkTarget,
} from './shipped-templates.js';
import {
  WORKER_NAMES,
  buildAgentsIndexMarkdown,
  buildFactoryArtifacts,
  classifyAgentsPath,
  FactoryError,
  formatFactoryInitPrint,
  formatFactoryInitSummary,
  planOwnedPrune,
  pruneUnknownManifestKeys,
  readSyncManifest,
  runFactoryInit,
  runFactorySync,
} from './factory.js';
import { templateExists } from './templates.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('globalDirRefusalReason', () => {
  it('refuses the home directory itself', () => {
    const home = makeTempDir('plandesk-home-');
    expect(globalDirRefusalReason(home, home)).toBe('your home directory');
  });

  it('refuses global agent config directories under home', () => {
    const home = makeTempDir('plandesk-home-');
    for (const name of ['.claude', '.codex', '.agents', '.config', '.plandesk']) {
      expect(globalDirRefusalReason(join(home, name), home)).toBe(`the global ${name} directory`);
    }
  });

  it('allows project directories, including ones inside global dirs', () => {
    const home = makeTempDir('plandesk-home-');
    expect(globalDirRefusalReason(join(home, 'projects', 'my-app'), home)).toBeUndefined();
    // A repo nested below a global dir is not the global dir itself.
    expect(globalDirRefusalReason(join(home, '.claude', 'skills', 'foo'), home)).toBeUndefined();
  });

  it('allows a .claude-named directory outside home', () => {
    const home = makeTempDir('plandesk-home-');
    const elsewhere = makeTempDir('plandesk-elsewhere-');
    expect(globalDirRefusalReason(join(elsewhere, '.claude'), home)).toBeUndefined();
  });
});

describe('runFactoryInit', () => {
  it('scaffolds the .agents factory tree with a claude command adapter', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });

    const expected = [
      '.agents/index.md',
      '.agents/factory/factory.md',
      '.agents/factory/execution.md',
      '.agents/factory/slicing.md',
      '.agents/factory/brief.md',
      '.agents/factory/heartbeat.md',
      '.agents/factory/protocol.md',
      '.agents/factory/lanes.md',
      '.agents/factory/verifiers/tests-pass.md',
      '.agents/factory/runs/.gitignore',
      '.agents/factory/workers/claude.md',
      '.agents/factory/workers/codex.md',
      '.agents/factory/workers/cursor.md',
      '.agents/factory/workers/grok.md',
      '.agents/factory/workers/opencode.md',
      '.agents/factory/workers/pi.md',
      '.claude/commands/factory.md',
      '.codex/commands/factory.md',
      'CLAUDE.md',
    ];
    for (const rel of expected) {
      expect(existsSync(join(repo, rel)), rel).toBe(true);
    }
    expect(result.artifacts.every((a) => a.action === 'create')).toBe(true);

    const executionDoc = readFileSync(join(repo, '.agents/factory/execution.md'), 'utf8');
    expect(executionDoc.startsWith('---\ntype: execution\n')).toBe(true);
    expect(executionDoc).toContain('IC execution posture');

    const factoryDoc = readFileSync(join(repo, '.agents/factory/factory.md'), 'utf8');
    expect(factoryDoc.startsWith('---\ntype: factory\n')).toBe(true);
    expect(factoryDoc).toContain('get_next_task');
    expect(factoryDoc).toContain('start_agent_run');

    const command = readFileSync(join(repo, '.claude/commands/factory.md'), 'utf8');
    expect(command).toContain('@.agents/factory/factory.md');
    expect(command).toContain('@.agents/factory/execution.md');
    expect(command).toBe(`# Factory

@.agents/factory/factory.md

@.agents/factory/execution.md
`);

    const runsIgnore = readFileSync(join(repo, '.agents/factory/runs/.gitignore'), 'utf8');
    expect(runsIgnore).toContain('*');
  });

  it('never overwrites authored policy files on re-run', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    const lanesPath = join(repo, '.agents/factory/lanes.md');
    writeFileSync(lanesPath, 'my edited lanes\n', 'utf8');

    const rerun = runFactoryInit({ repoDir: repo });
    expect(readFileSync(lanesPath, 'utf8')).toBe('my edited lanes\n');

    const lanesArtifact = rerun.artifacts.find((a) => a.path === lanesPath);
    expect(lanesArtifact?.action).toBe('skip');
    // Command adapters are generated and refresh on every run.
    const adapter = rerun.artifacts.find((a) => a.path.endsWith('.claude/commands/factory.md'));
    expect(adapter?.action).toBe('update');
  });

  it('respects agent detection for command adapters', () => {
    const repo = makeTempDir('plandesk-factory-');
    // CLAUDE.md present, no .codex — claude-only repo.
    writeFileSync(join(repo, 'CLAUDE.md'), '# repo\n', 'utf8');
    runFactoryInit({ repoDir: repo });
    expect(existsSync(join(repo, '.claude/commands/factory.md'))).toBe(true);
    expect(existsSync(join(repo, '.codex/commands/factory.md'))).toBe(false);
  });

  it('supports --print without writing files', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo, print: true });
    expect(existsSync(join(repo, '.agents'))).toBe(false);
    const printout = formatFactoryInitPrint(result);
    expect(printout).toContain('type: factory');
    expect(printout).toContain('.agents/factory/workers/claude.md');
  });

  it('refuses global config directories unless --force', () => {
    const home = makeTempDir('plandesk-home-');
    const globalClaude = join(home, '.claude');
    mkdirSync(globalClaude, { recursive: true });

    expect(() => runFactoryInit({ repoDir: globalClaude, homeDir: home })).toThrow(FactoryError);
    expect(existsSync(join(globalClaude, '.agents'))).toBe(false);
    // The guard is all-or-nothing (it throws before buildFactoryArtifacts is
    // ever called), so proving it covers the scaffold surface is proving these
    // never get written either — not a per-file check.
    for (const template of SHIPPED_TEMPLATES) {
      expect(
        existsSync(agentsArtifactPath(globalClaude, template.relativePath)),
        template.relativePath,
      ).toBe(false);
    }
    expect(existsSync(join(globalClaude, '.claude/settings.json'))).toBe(false);

    const forced = runFactoryInit({ repoDir: globalClaude, homeDir: home, force: true });
    expect(forced.artifacts.length).toBeGreaterThan(0);
    expect(existsSync(join(globalClaude, '.agents/factory/factory.md'))).toBe(true);
    // --force lifts the guard for the whole scaffold, shipped artifacts included.
    for (const template of SHIPPED_TEMPLATES) {
      expect(
        existsSync(agentsArtifactPath(globalClaude, template.relativePath)),
        template.relativePath,
      ).toBe(true);
    }
    expect(existsSync(join(globalClaude, '.claude/settings.json'))).toBe(true);
  });

  it('formats a summary naming skip semantics', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });
    const summary = formatFactoryInitSummary(result);
    expect(summary).toContain(`Factory workspace ready at ${join(repo, '.agents')}`);
    expect(summary).toContain('create:');
  });
});

describe('always-on policy include', () => {
  it('inserts an idempotent factory sentinel block into CLAUDE.md', () => {
    const repo = makeTempDir('plandesk-factory-');
    writeFileSync(join(repo, 'CLAUDE.md'), '# My repo\n', 'utf8');
    runFactoryInit({ repoDir: repo });
    const first = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(first).toContain('# My repo');
    expect(first).toContain('<!-- plandesk-factory:start -->');
    // Less-is-more: the always-on block carries the crisp preamble gate plus
    // exactly ONE @-include — factory.md, the per-item contract whose absence
    // would change behavior. execution.md is referenced by path in the
    // preamble, not inlined into every session's context.
    expect(first).toContain('@.agents/factory/factory.md');
    expect(first).not.toContain('@.agents/factory/execution.md');
    expect(first).toContain('[execution.md](.agents/factory/execution.md)');
    // Always-on directive preamble: use the factory cycle, drive via harness
    // tasks, prove before done.
    expect(first).toContain('Plan Desk Factory — default operating mode');
    expect(first).toContain('start_agent_run');
    expect(first).toContain('TaskCreate');

    runFactoryInit({ repoDir: repo });
    const second = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(second).toBe(first);
    expect(second.match(/plandesk-factory:start/g)).toHaveLength(1);
  });

  it('updates AGENTS.md when present, never creates it', () => {
    const repo = makeTempDir('plandesk-factory-');
    writeFileSync(join(repo, 'AGENTS.md'), '# Agents\n', 'utf8');
    runFactoryInit({ repoDir: repo });
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('plandesk-factory:start');

    const bare = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: bare });
    expect(existsSync(join(bare, 'AGENTS.md'))).toBe(false);
  });
});

describe('buildFactoryArtifacts', () => {
  it('is pure with respect to an empty repo', () => {
    const repo = makeTempDir('plandesk-factory-');
    const artifacts = buildFactoryArtifacts(repo);
    expect(existsSync(join(repo, '.agents'))).toBe(false);
    expect(artifacts.length).toBeGreaterThanOrEqual(13);
  });
});

describe('worker files', () => {
  const dispatchRuleFooter = [
    'Dispatch rule: run `probe` first — if it fails, this worker does not exist on',
    'this machine; pick another file in this directory. Substitute {prompt_file}',
    'with the brief path and run `command` verbatim. The result contract is',
    'defined in [../protocol.md](../protocol.md).',
  ].join('\n');

  it('every worker declares a probe and a {prompt_file} command template', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    for (const name of WORKER_NAMES) {
      const content = readFileSync(join(repo, `.agents/factory/workers/${name}.md`), 'utf8');
      expect(content, name).toContain('type: worker');
      expect(content, name).toContain('probe: command -v ');
      expect(content, name).toContain('{prompt_file}');
    }
  });

  it('every worker file ends with the shared dispatch-rule footer', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    for (const name of WORKER_NAMES) {
      const content = readFileSync(join(repo, `.agents/factory/workers/${name}.md`), 'utf8');
      expect(content, name).toContain(dispatchRuleFooter);
    }
  });

  it('protocol defines the result contract and deterministic verification', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    const protocol = readFileSync(join(repo, '.agents/factory/protocol.md'), 'utf8');
    expect(protocol).toContain('type: protocol');
    expect(protocol).toContain('runs/result-<task>.json');
    expect(protocol).toContain('Exit codes are authoritative');
  });
});

describe('template invariant', () => {
  it('every path buildFactoryArtifacts emits under .agents/ resolves to a real template', () => {
    const repo = makeTempDir('plandesk-factory-');
    const artifacts = buildFactoryArtifacts(repo);
    const agentsPaths = artifacts
      .map((a) => relative(repo, a.path).replace(/\\/g, '/'))
      .filter((rel) => rel.startsWith('.agents/'));
    expect(agentsPaths.length).toBeGreaterThan(0);
    for (const rel of agentsPaths) {
      const templateRel = rel.slice('.agents/'.length);
      expect(templateExists(templateRel), `missing template for ${rel}`).toBe(true);
    }
  });
});

describe('scaffold artifacts (F5)', () => {
  it('scaffolds all 10 shipped artifacts create-if-missing, with hook scripts executable', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });

    for (const template of SHIPPED_TEMPLATES) {
      const path = agentsArtifactPath(repo, template.relativePath);
      expect(existsSync(path), template.relativePath).toBe(true);
      expect(readFileSync(path, 'utf8'), template.relativePath).toBe(template.content);
      const artifact = result.artifacts.find((a) => a.path === path);
      expect(artifact?.action, template.relativePath).toBe('create');
      if (template.executable === true) {
        const mode = statSync(path).mode;
        expect(mode & 0o111, `${template.relativePath} should be executable`).not.toBe(0);
      }
    }

    const triage = readFileSync(join(repo, '.agents/skills/plandesk-scope-work/SKILL.md'), 'utf8');
    expect(triage.startsWith('---\nname: plandesk-scope-work\ndescription: ')).toBe(true);
    expect(triage).not.toContain('type: curator-skill');
  });

  it('never overwrites a shipped artifact the user edited, on re-run', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    const triagePath = join(repo, '.agents/skills/plandesk-scope-work/SKILL.md');
    writeFileSync(triagePath, 'my edited triage skill\n', 'utf8');

    const rerun = runFactoryInit({ repoDir: repo });
    expect(readFileSync(triagePath, 'utf8')).toBe('my edited triage skill\n');
    const triageArtifact = rerun.artifacts.find((a) => a.path === triagePath);
    expect(triageArtifact?.action).toBe('skip');
  });

  it('--print previews all 10 shipped artifacts and the settings.json merge', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo, print: true });
    expect(existsSync(join(repo, '.agents/skills/plandesk-scope-work'))).toBe(false);

    const printout = formatFactoryInitPrint(result);
    for (const template of SHIPPED_TEMPLATES) {
      expect(printout, template.relativePath).toContain(template.relativePath);
    }
    expect(printout).toContain(join(repo, '.claude/settings.json'));
    expect(printout).toContain('plandesk progress-checkpoint');
  });

  it('symlinks .claude/skills adapters to the canonical .agents/skills files', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    for (const name of SHIPPED_SKILL_NAMES) {
      const adapterPath = join(repo, '.claude/skills', name, 'SKILL.md');
      expect(existsSync(adapterPath), name).toBe(true);
      expect(lstatSync(adapterPath).isSymbolicLink(), name).toBe(true);
      expect(readlinkSync(adapterPath), name).toBe(skillSymlinkTarget(name));
      const content = readFileSync(adapterPath, 'utf8');
      expect(content.startsWith(`---\nname: ${name}\ndescription: `)).toBe(true);
      expect(content).not.toContain('type: curator-skill');
    }
  });

  it('symlink adapter reflects an edited .agents skill without regenerating content', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    const sourcePath = join(repo, '.agents/skills/plandesk-scope-work/SKILL.md');
    writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n\nEDITED MARKER.\n`, 'utf8');
    runFactoryInit({ repoDir: repo });

    const adapterPath = join(repo, '.claude/skills/plandesk-scope-work/SKILL.md');
    expect(lstatSync(adapterPath).isSymbolicLink()).toBe(true);
    const adapter = readFileSync(adapterPath, 'utf8');
    expect(adapter).toContain('EDITED MARKER.');
    expect(adapter.startsWith('---\nname: plandesk-scope-work\ndescription: ')).toBe(true);
  });
});

describe('board-as-memory hooks settings.json merge (F1 wiring)', () => {
  it('creates .claude/settings.json with the SessionStart/Stop/PreCompact hooks when absent', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });
    const settingsPath = join(repo, '.claude/settings.json');
    expect(existsSync(settingsPath)).toBe(true);

    const artifact = result.artifacts.find((a) => a.path === settingsPath);
    expect(artifact?.action).toBe('create');

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain(
      '.agents/factory/hooks/session-start.sh',
    );
    expect(JSON.stringify(settings.hooks.Stop)).toContain('.agents/factory/hooks/checkpoint.sh');
    // Hook commands are prefixed with $CLAUDE_PROJECT_DIR so they resolve against the
    // project root even when Claude Code is launched from a subdirectory.
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain(
      '$CLAUDE_PROJECT_DIR/.agents/factory/hooks/session-start.sh',
    );
  });

  it('merges additively into an existing settings.json without touching unrelated hooks', () => {
    const repo = makeTempDir('plandesk-factory-');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    const settingsPath = join(repo, '.claude/settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [{ hooks: [{ type: 'command', command: 'echo my-hook' }] }],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = runFactoryInit({ repoDir: repo });
    const artifact = result.artifacts.find((a) => a.path === settingsPath);
    expect(artifact?.action).toBe('update');

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    // Unrelated hook untouched.
    expect(settings.hooks.PostToolUse).toEqual([
      { hooks: [{ type: 'command', command: 'echo my-hook' }] },
    ]);
    // Board-as-memory hooks added.
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });

  it('is idempotent — running factory init twice does not duplicate hook entries', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    const settingsPath = join(repo, '.claude/settings.json');
    const first = readFileSync(settingsPath, 'utf8');

    const rerun = runFactoryInit({ repoDir: repo });
    const second = readFileSync(settingsPath, 'utf8');
    expect(second).toBe(first);

    const artifact = rerun.artifacts.find((a) => a.path === settingsPath);
    expect(artifact?.action).toBe('update');

    const settings = JSON.parse(second) as { hooks: Record<string, unknown[]> };
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });

  it('preserves a user-added SessionStart hook alongside the Plan Desk one on rerun', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    const settingsPath = join(repo, '.claude/settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    settings.hooks.SessionStart = [
      ...(settings.hooks.SessionStart ?? []),
      { hooks: [{ type: 'command', command: 'echo user-hook' }] },
    ];
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    runFactoryInit({ repoDir: repo });
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(after.hooks.SessionStart).toHaveLength(2);
    expect(JSON.stringify(after.hooks.SessionStart)).toContain('echo user-hook');
    expect(JSON.stringify(after.hooks.SessionStart)).toContain('session-start.sh');
  });
});

describe('factory sync', () => {
  const protocolRel = '.agents/factory/protocol.md';
  const lanesRel = '.agents/factory/lanes.md';

  it('reports everything up to date right after init (dry-run writes nothing)', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const result = runFactorySync({ repoDir: repo });
    expect(result.applied).toBe(false);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.status === 'up_to_date')).toBe(true);
  });

  // A skill shipped after a repo was initialised used to land in .agents/skills/
  // and stay invisible: Claude Code reads .claude/skills/, and only `init` wrote
  // those links. Eight real repos had plandesk-foreman present and committed, and
  // not one of them could invoke it.
  it('links a newly shipped skill so the agent can actually reach it', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });

    // Simulate a repo initialised before this skill existed.
    const canonical = join(repo, '.agents/skills/plandesk-foreman/SKILL.md');
    const adapter = join(repo, '.claude/skills/plandesk-foreman/SKILL.md');
    rmSync(join(repo, '.agents/skills/plandesk-foreman'), { recursive: true, force: true });
    rmSync(join(repo, '.claude/skills/plandesk-foreman'), { recursive: true, force: true });
    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(adapter)).toBe(false);

    const result = runFactorySync({ repoDir: repo, write: true });

    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(adapter)).toBe(true);
    expect(result.linked).toContain('.claude/skills/plandesk-foreman/SKILL.md');
  });

  it('recreates a deleted authored file (create), and dry-run leaves it missing', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const protocolPath = join(repo, protocolRel);
    rmSync(protocolPath);

    const plan = runFactorySync({ repoDir: repo });
    expect(plan.entries.find((e) => e.relPath === protocolRel)?.status).toBe('create');
    expect(existsSync(protocolPath)).toBe(false); // dry-run wrote nothing

    runFactorySync({ repoDir: repo, write: true });
    expect(existsSync(protocolPath)).toBe(true);
  });

  it('protects a user-edited file as a conflict and keeps it on --write', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const lanesPath = join(repo, lanesRel);
    writeFileSync(lanesPath, '# my custom lanes\n', 'utf8');

    const plan = runFactorySync({ repoDir: repo });
    expect(plan.entries.find((e) => e.relPath === lanesRel)?.status).toBe('conflict');

    runFactorySync({ repoDir: repo, write: true });
    expect(readFileSync(lanesPath, 'utf8')).toBe('# my custom lanes\n'); // kept
  });

  it('overwrites a conflict only with --force', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const lanesPath = join(repo, lanesRel);
    const shipped = readFileSync(lanesPath, 'utf8');
    writeFileSync(lanesPath, '# my custom lanes\n', 'utf8');

    runFactorySync({ repoDir: repo, force: true });
    expect(readFileSync(lanesPath, 'utf8')).toBe(shipped); // restored
  });

  it('safe-updates a stale-but-unmodified file (manifest base matches on-disk)', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const protocolPath = join(repo, protocolRel);
    const shipped = readFileSync(protocolPath, 'utf8');

    // Simulate an older shipped version the user has NOT edited: put "old" on
    // disk and record it as the manifest base (what the CLI last wrote).
    const old = '# old protocol\n';
    writeFileSync(protocolPath, old, 'utf8');
    const manifestPath = join(repo, '.agents/.plandesk-sync.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Record<string, string>;
    };
    manifest.files[protocolRel] = createHash('sha256').update(old, 'utf8').digest('hex');
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    const plan = runFactorySync({ repoDir: repo });
    expect(plan.entries.find((e) => e.relPath === protocolRel)?.status).toBe('safe_update');

    runFactorySync({ repoDir: repo, write: true });
    expect(readFileSync(protocolPath, 'utf8')).toBe(shipped); // updated to shipped
  });

  it('drops unknown keys from the sync manifest on write (no rename-migration table)', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const manifestPath = join(repo, '.agents/.plandesk-sync.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Record<string, string>;
    };
    // Simulate keys left behind by the curator → skills move.
    manifest.files['.agents/curator/triage.md'] = 'deadbeef';
    manifest.files['.agents/curator/hooks/session-start.sh'] = 'cafebabe';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    runFactorySync({ repoDir: repo, write: true });
    const after = readSyncManifest(repo);
    expect(after['.agents/curator/triage.md']).toBeUndefined();
    expect(after['.agents/curator/hooks/session-start.sh']).toBeUndefined();
    // Still-declared owned files remain.
    expect(after[protocolRel]).toBeTypeOf('string');
  });

  it('prunes only owned stale files; foreign and shared-namespace paths survive', () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });

    // Foreign files another tool owns.
    const otherSkill = join(repo, '.agents/skills/other-tool/SKILL.md');
    const otherMd = join(repo, '.agents/other.md');
    mkdirSync(join(repo, '.agents/skills/other-tool'), { recursive: true });
    writeFileSync(otherSkill, 'foreign skill body\n', 'utf8');
    writeFileSync(otherMd, 'foreign other.md\n', 'utf8');

    // Stale owned path the CLI once shipped (no longer declared).
    const staleOwnedRel = '.agents/factory/legacy-gone.md';
    const staleOwned = join(repo, staleOwnedRel);
    const staleBody = '# legacy\n';
    writeFileSync(staleOwned, staleBody, 'utf8');

    // Stale shared-namespace path — must NOT be deleted even if in the manifest.
    const staleSkillRel = '.agents/skills/old-skill/SKILL.md';
    const staleSkill = join(repo, staleSkillRel);
    mkdirSync(join(repo, '.agents/skills/old-skill'), { recursive: true });
    writeFileSync(staleSkill, 'old skill\n', 'utf8');

    const manifestPath = join(repo, '.agents/.plandesk-sync.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Record<string, string>;
    };
    manifest.files[staleOwnedRel] = createHash('sha256').update(staleBody, 'utf8').digest('hex');
    manifest.files[staleSkillRel] = createHash('sha256').update('old skill\n', 'utf8').digest('hex');
    manifest.files['.agents/curator/triage.md'] = 'orphan-key';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    expect(planOwnedPrune(repo)).toEqual([staleOwnedRel]);

    const result = runFactorySync({ repoDir: repo, prune: true });
    expect(result.applied).toBe(true);
    expect(result.pruned).toEqual([staleOwnedRel]);
    expect(existsSync(staleOwned)).toBe(false);
    expect(existsSync(staleSkill)).toBe(true);
    expect(readFileSync(staleSkill, 'utf8')).toBe('old skill\n');
    expect(readFileSync(otherSkill, 'utf8')).toBe('foreign skill body\n');
    expect(readFileSync(otherMd, 'utf8')).toBe('foreign other.md\n');

    const after = readSyncManifest(repo);
    expect(after[staleOwnedRel]).toBeUndefined();
    expect(after[staleSkillRel]).toBeUndefined();
    expect(after['.agents/curator/triage.md']).toBeUndefined();
  });
});

describe('classifyAgentsPath', () => {
  it('classifies owned, shared_namespace, shared_file, and foreign tiers', () => {
    expect(classifyAgentsPath('.agents/factory/protocol.md')).toBe('owned');
    expect(classifyAgentsPath('.agents/factory/hooks/session-start.sh')).toBe('owned');
    expect(classifyAgentsPath('.agents/factory/workers/claude.md')).toBe('owned');
    expect(classifyAgentsPath('.agents/.plandesk-sync.json')).toBe('owned');
    expect(classifyAgentsPath('.agents/skills/plandesk-scope-work/SKILL.md')).toBe('shared_namespace');
    expect(classifyAgentsPath('.agents/skills/other-tool/SKILL.md')).toBe('shared_namespace');
    expect(classifyAgentsPath('.agents/index.md')).toBe('shared_file');
    expect(classifyAgentsPath('.agents/other.md')).toBe('foreign');
    expect(classifyAgentsPath('.agents/curator/triage.md')).toBe('foreign');
  });
});

describe('pruneUnknownManifestKeys', () => {
  it('keeps only declared keys', () => {
    const cleaned = pruneUnknownManifestKeys(
      {
        '.agents/factory/protocol.md': 'a',
        '.agents/curator/triage.md': 'b',
      },
      new Set(['.agents/factory/protocol.md']),
    );
    expect(cleaned).toEqual({ '.agents/factory/protocol.md': 'a' });
  });
});

describe('agents index shared-file sentinel', () => {
  it('writes a Plan Desk block into index.md and regenerates on every init', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });
    const indexPath = join(repo, '.agents/index.md');
    const first = readFileSync(indexPath, 'utf8');
    expect(first).toContain(AGENTS_INDEX_SENTINEL_START);
    expect(first).toContain(AGENTS_INDEX_SENTINEL_END);
    expect(first).toContain(buildAgentsIndexMarkdown().replace(/\n+$/, ''));
    const indexArtifact = result.artifacts.find((a) => a.path === indexPath);
    expect(indexArtifact?.action).toBe('create');

    const rerun = runFactoryInit({ repoDir: repo });
    const second = readFileSync(indexPath, 'utf8');
    expect(second).toBe(first);
    expect(second.match(/plandesk-agents-index:start/g)).toHaveLength(1);
    expect(rerun.artifacts.find((a) => a.path === indexPath)?.action).toBe('update');
  });

  it('preserves foreign index.md content and inserts exactly one Plan Desk block', () => {
    const repo = makeTempDir('plandesk-factory-');
    mkdirSync(join(repo, '.agents'), { recursive: true });
    const foreign = '# Other tool map\n\n- [their/file.md](their/file.md)\n';
    writeFileSync(join(repo, '.agents/index.md'), foreign, 'utf8');

    runFactoryInit({ repoDir: repo });
    const once = readFileSync(join(repo, '.agents/index.md'), 'utf8');
    expect(once).toContain('# Other tool map');
    expect(once).toContain('[their/file.md](their/file.md)');
    expect(once).toContain(AGENTS_INDEX_SENTINEL_START);
    expect(once.match(/plandesk-agents-index:start/g)).toHaveLength(1);

    runFactoryInit({ repoDir: repo });
    const twice = readFileSync(join(repo, '.agents/index.md'), 'utf8');
    expect(twice).toBe(once);
    expect(twice.match(/plandesk-agents-index:start/g)).toHaveLength(1);
  });

  it('foreign skill and foreign other.md survive factory init and sync --prune', () => {
    const repo = makeTempDir('plandesk-factory-');
    mkdirSync(join(repo, '.agents/skills/other-tool'), { recursive: true });
    const skillPath = join(repo, '.agents/skills/other-tool/SKILL.md');
    const otherPath = join(repo, '.agents/other.md');
    const skillBody = 'other-tool skill — do not touch\n';
    const otherBody = 'other.md — do not touch\n';
    writeFileSync(skillPath, skillBody, 'utf8');
    writeFileSync(otherPath, otherBody, 'utf8');

    runFactoryInit({ repoDir: repo });
    runFactorySync({ repoDir: repo, prune: true });

    expect(readFileSync(skillPath, 'utf8')).toBe(skillBody);
    expect(readFileSync(otherPath, 'utf8')).toBe(otherBody);
  });
});
