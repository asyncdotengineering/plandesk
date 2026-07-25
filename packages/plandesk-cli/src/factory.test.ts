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
import { globalDirRefusalReason } from './connect-artifacts.js';
import {
  CURATOR_SKILL_NAMES,
  CURATOR_TEMPLATES,
  curatorArtifactPath,
  curatorSkillSymlinkTarget,
} from './curator-templates.js';
import {
  WORKER_NAMES,
  buildFactoryArtifacts,
  FactoryError,
  formatFactoryInitPrint,
  formatFactoryInitSummary,
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
  it('refuses the home directory itself', async () => {
    const home = makeTempDir('plandesk-home-');
    expect(globalDirRefusalReason(home, home)).toBe('your home directory');
  });

  it('refuses global agent config directories under home', async () => {
    const home = makeTempDir('plandesk-home-');
    for (const name of ['.claude', '.codex', '.agents', '.config', '.plandesk']) {
      expect(globalDirRefusalReason(join(home, name), home)).toBe(`the global ${name} directory`);
    }
  });

  it('allows project directories, including ones inside global dirs', async () => {
    const home = makeTempDir('plandesk-home-');
    expect(globalDirRefusalReason(join(home, 'projects', 'my-app'), home)).toBeUndefined();
    // A repo nested below a global dir is not the global dir itself.
    expect(globalDirRefusalReason(join(home, '.claude', 'skills', 'foo'), home)).toBeUndefined();
  });

  it('allows a .claude-named directory outside home', async () => {
    const home = makeTempDir('plandesk-home-');
    const elsewhere = makeTempDir('plandesk-elsewhere-');
    expect(globalDirRefusalReason(join(elsewhere, '.claude'), home)).toBeUndefined();
  });
});

describe('runFactoryInit', () => {
  it('scaffolds the .agents factory tree with a claude command adapter', async () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });

    const expected = [
      '.agents/index.md',
      '.agents/factory/workflow.md',
      '.agents/factory/factory.md',
      '.agents/factory/autonomous-stand.md',
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

    const workflowDoc = readFileSync(join(repo, '.agents/factory/workflow.md'), 'utf8');
    expect(workflowDoc.startsWith('---\ntype: workflow\n')).toBe(true);
    expect(workflowDoc).toContain('Orchestrator workflow');

    const factoryDoc = readFileSync(join(repo, '.agents/factory/factory.md'), 'utf8');
    expect(factoryDoc.startsWith('---\ntype: factory\n')).toBe(true);
    expect(factoryDoc).toContain('get_next_task');

    const command = readFileSync(join(repo, '.claude/commands/factory.md'), 'utf8');
    expect(command).toContain('@.agents/factory/factory.md');
    expect(command).toContain('@.agents/factory/autonomous-stand.md');

    const runsIgnore = readFileSync(join(repo, '.agents/factory/runs/.gitignore'), 'utf8');
    expect(runsIgnore).toContain('*');
  });

  it('never overwrites authored policy files on re-run', async () => {
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

  it('respects agent detection for command adapters', async () => {
    const repo = makeTempDir('plandesk-factory-');
    // CLAUDE.md present, no .codex — claude-only repo.
    writeFileSync(join(repo, 'CLAUDE.md'), '# repo\n', 'utf8');
    runFactoryInit({ repoDir: repo });
    expect(existsSync(join(repo, '.claude/commands/factory.md'))).toBe(true);
    expect(existsSync(join(repo, '.codex/commands/factory.md'))).toBe(false);
  });

  it('supports --print without writing files', async () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo, print: true });
    expect(existsSync(join(repo, '.agents'))).toBe(false);
    const printout = formatFactoryInitPrint(result);
    expect(printout).toContain('type: factory');
    expect(printout).toContain('.agents/factory/workers/claude.md');
  });

  it('refuses global config directories unless --force', async () => {
    const home = makeTempDir('plandesk-home-');
    const globalClaude = join(home, '.claude');
    mkdirSync(globalClaude, { recursive: true });

    expect(() => runFactoryInit({ repoDir: globalClaude, homeDir: home })).toThrow(FactoryError);
    expect(existsSync(join(globalClaude, '.agents'))).toBe(false);
    // The guard is all-or-nothing (it throws before buildFactoryArtifacts is
    // ever called), so proving it covers the curator surface is proving these
    // never get written either — not a per-file check.
    for (const template of CURATOR_TEMPLATES) {
      expect(
        existsSync(curatorArtifactPath(globalClaude, template.relativePath)),
        template.relativePath,
      ).toBe(false);
    }
    expect(existsSync(join(globalClaude, '.claude/settings.json'))).toBe(false);

    const forced = runFactoryInit({ repoDir: globalClaude, homeDir: home, force: true });
    expect(forced.artifacts.length).toBeGreaterThan(0);
    expect(existsSync(join(globalClaude, '.agents/factory/factory.md'))).toBe(true);
    // --force lifts the guard for the whole scaffold, curator artifacts included.
    for (const template of CURATOR_TEMPLATES) {
      expect(
        existsSync(curatorArtifactPath(globalClaude, template.relativePath)),
        template.relativePath,
      ).toBe(true);
    }
    expect(existsSync(join(globalClaude, '.claude/settings.json'))).toBe(true);
  });

  it('formats a summary naming skip semantics', async () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });
    const summary = formatFactoryInitSummary(result);
    expect(summary).toContain(`Factory workspace ready at ${join(repo, '.agents')}`);
    expect(summary).toContain('create:');
  });
});

describe('always-on policy include', () => {
  it('inserts an idempotent factory sentinel block into CLAUDE.md', async () => {
    const repo = makeTempDir('plandesk-factory-');
    writeFileSync(join(repo, 'CLAUDE.md'), '# My repo\n', 'utf8');
    runFactoryInit({ repoDir: repo });
    const first = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(first).toContain('# My repo');
    expect(first).toContain('<!-- plandesk-factory:start -->');
    // Less-is-more: the always-on block carries the crisp preamble gate plus
    // exactly ONE @-include — factory.md, the per-item contract whose absence
    // would change behavior. workflow.md and autonomous-stand.md are referenced
    // by path in the preamble, not inlined into every session's context.
    expect(first).toContain('@.agents/factory/factory.md');
    expect(first).not.toContain('@.agents/factory/workflow.md');
    expect(first).not.toContain('@.agents/factory/autonomous-stand.md');
    expect(first).toContain('[workflow.md](.agents/factory/workflow.md)');
    expect(first).toContain('[autonomous-stand.md](.agents/factory/autonomous-stand.md)');
    // Always-on directive preamble: use the factory as default workflow,
    // operate in autonomous-stand mode, drive via harness tasks.
    expect(first).toContain('Plan Desk Factory — default operating mode');
    expect(first).toContain('autonomous-stand mode');
    expect(first).toContain('TaskCreate');

    runFactoryInit({ repoDir: repo });
    const second = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    expect(second).toBe(first);
    expect(second.match(/plandesk-factory:start/g)).toHaveLength(1);
  });

  it('updates AGENTS.md when present, never creates it', async () => {
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
  it('is pure with respect to an empty repo', async () => {
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

  it('every worker declares a probe and a {prompt_file} command template', async () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    for (const name of WORKER_NAMES) {
      const content = readFileSync(join(repo, `.agents/factory/workers/${name}.md`), 'utf8');
      expect(content, name).toContain('type: worker');
      expect(content, name).toContain('probe: command -v ');
      expect(content, name).toContain('{prompt_file}');
    }
  });

  it('every worker file ends with the shared dispatch-rule footer', async () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    for (const name of WORKER_NAMES) {
      const content = readFileSync(join(repo, `.agents/factory/workers/${name}.md`), 'utf8');
      expect(content, name).toContain(dispatchRuleFooter);
    }
  });

  it('protocol defines the result contract and deterministic verification', async () => {
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

describe('curator artifacts (F5)', () => {
  it('scaffolds all 10 curator artifacts create-if-missing, with hook scripts executable', async () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });

    for (const template of CURATOR_TEMPLATES) {
      const path = curatorArtifactPath(repo, template.relativePath);
      expect(existsSync(path), template.relativePath).toBe(true);
      expect(readFileSync(path, 'utf8'), template.relativePath).toBe(template.content);
      const artifact = result.artifacts.find((a) => a.path === path);
      expect(artifact?.action, template.relativePath).toBe('create');
      if (template.executable === true) {
        const mode = statSync(path).mode;
        expect(mode & 0o111, `${template.relativePath} should be executable`).not.toBe(0);
      }
    }

    const triage = readFileSync(join(repo, '.agents/skills/curator-triage/SKILL.md'), 'utf8');
    expect(triage.startsWith('---\nname: curator-triage\ndescription: ')).toBe(true);
    expect(triage).not.toContain('type: curator-skill');
  });

  it('never overwrites a curator artifact the user edited, on re-run', async () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    const triagePath = join(repo, '.agents/skills/curator-triage/SKILL.md');
    writeFileSync(triagePath, 'my edited triage skill\n', 'utf8');

    const rerun = runFactoryInit({ repoDir: repo });
    expect(readFileSync(triagePath, 'utf8')).toBe('my edited triage skill\n');
    const triageArtifact = rerun.artifacts.find((a) => a.path === triagePath);
    expect(triageArtifact?.action).toBe('skip');
  });

  it('--print previews all 10 curator artifacts and the settings.json merge', async () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo, print: true });
    expect(existsSync(join(repo, '.agents/skills/curator-triage'))).toBe(false);

    const printout = formatFactoryInitPrint(result);
    for (const template of CURATOR_TEMPLATES) {
      expect(printout, template.relativePath).toContain(template.relativePath);
    }
    expect(printout).toContain(join(repo, '.claude/settings.json'));
    expect(printout).toContain('plandesk progress-checkpoint');
  });

  it('symlinks .claude/skills adapters to the canonical .agents/skills files', async () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    for (const name of CURATOR_SKILL_NAMES) {
      const adapterPath = join(repo, '.claude/skills', name, 'SKILL.md');
      expect(existsSync(adapterPath), name).toBe(true);
      expect(lstatSync(adapterPath).isSymbolicLink(), name).toBe(true);
      expect(readlinkSync(adapterPath), name).toBe(curatorSkillSymlinkTarget(name));
      const content = readFileSync(adapterPath, 'utf8');
      expect(content.startsWith(`---\nname: ${name}\ndescription: `)).toBe(true);
      expect(content).not.toContain('type: curator-skill');
    }
  });

  it('symlink adapter reflects an edited .agents skill without regenerating content', async () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });

    const sourcePath = join(repo, '.agents/skills/curator-triage/SKILL.md');
    writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n\nEDITED MARKER.\n`, 'utf8');
    runFactoryInit({ repoDir: repo });

    const adapterPath = join(repo, '.claude/skills/curator-triage/SKILL.md');
    expect(lstatSync(adapterPath).isSymbolicLink()).toBe(true);
    const adapter = readFileSync(adapterPath, 'utf8');
    expect(adapter).toContain('EDITED MARKER.');
    expect(adapter.startsWith('---\nname: curator-triage\ndescription: ')).toBe(true);
  });
});

describe('curator hooks settings.json merge (F1 wiring)', () => {
  it('creates .claude/settings.json with the SessionStart/Stop/PreCompact hooks when absent', async () => {
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

  it('merges additively into an existing settings.json without touching unrelated hooks', async () => {
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
    // Curator hooks added.
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
  });

  it('is idempotent — running factory init twice does not duplicate curator hook entries', async () => {
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

  it('preserves a user-added SessionStart hook alongside the curator one on rerun', async () => {
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

  it('reports everything up to date right after init (dry-run writes nothing)', async () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const result = runFactorySync({ repoDir: repo });
    expect(result.applied).toBe(false);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.status === 'up_to_date')).toBe(true);
  });

  it('recreates a deleted authored file (create), and dry-run leaves it missing', async () => {
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

  it('protects a user-edited file as a conflict and keeps it on --write', async () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const lanesPath = join(repo, lanesRel);
    writeFileSync(lanesPath, '# my custom lanes\n', 'utf8');

    const plan = runFactorySync({ repoDir: repo });
    expect(plan.entries.find((e) => e.relPath === lanesRel)?.status).toBe('conflict');

    runFactorySync({ repoDir: repo, write: true });
    expect(readFileSync(lanesPath, 'utf8')).toBe('# my custom lanes\n'); // kept
  });

  it('overwrites a conflict only with --force', async () => {
    const repo = makeTempDir('plandesk-sync-');
    runFactoryInit({ repoDir: repo });
    const lanesPath = join(repo, lanesRel);
    const shipped = readFileSync(lanesPath, 'utf8');
    writeFileSync(lanesPath, '# my custom lanes\n', 'utf8');

    runFactorySync({ repoDir: repo, force: true });
    expect(readFileSync(lanesPath, 'utf8')).toBe(shipped); // restored
  });

  it('safe-updates a stale-but-unmodified file (manifest base matches on-disk)', async () => {
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
});
