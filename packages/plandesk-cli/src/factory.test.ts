import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { globalDirRefusalReason } from './connect-artifacts.js';
import {
  buildFactoryArtifacts,
  FactoryError,
  formatFactoryInitPrint,
  formatFactoryInitSummary,
  runFactoryInit,
} from './factory.js';

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
      expect(globalDirRefusalReason(join(home, name), home)).toBe(
        `the global ${name} directory`,
      );
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
      '.agents/factory/workflow.md',
      '.agents/factory/factory.md',
      '.agents/factory/protocol.md',
      '.agents/factory/lanes.md',
      '.agents/factory/verifiers/tests-pass.md',
      '.agents/factory/runs/.gitignore',
      '.agents/factory/workers/claude.md',
      '.agents/factory/workers/codex.md',
      '.agents/factory/workers/cursor.md',
      '.agents/factory/workers/grok.md',
      '.agents/factory/workers/opencode.md',
      '.claude/commands/factory.md',
      '.codex/commands/factory.md',
    ];
    for (const rel of expected) {
      expect(existsSync(join(repo, rel)), rel).toBe(true);
    }
    expect(result.artifacts.every((a) => a.action === 'create')).toBe(true);

    const workflowDoc = readFileSync(join(repo, '.agents/factory/workflow.md'), 'utf8');
    expect(workflowDoc.startsWith('---\ntype: workflow\n')).toBe(true);
    expect(workflowDoc).toContain('shipped default');

    const factoryDoc = readFileSync(join(repo, '.agents/factory/factory.md'), 'utf8');
    expect(factoryDoc.startsWith('---\ntype: factory\n')).toBe(true);
    expect(factoryDoc).toContain('get_next_task');

    const command = readFileSync(join(repo, '.claude/commands/factory.md'), 'utf8');
    expect(command).toContain('@.agents/factory/factory.md');

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

    const forced = runFactoryInit({ repoDir: globalClaude, homeDir: home, force: true });
    expect(forced.artifacts.length).toBeGreaterThan(0);
    expect(existsSync(join(globalClaude, '.agents/factory/factory.md'))).toBe(true);
  });

  it('formats a summary naming skip semantics', () => {
    const repo = makeTempDir('plandesk-factory-');
    const result = runFactoryInit({ repoDir: repo });
    const summary = formatFactoryInitSummary(result);
    expect(summary).toContain(`Factory workspace ready at ${join(repo, '.agents')}`);
    expect(summary).toContain('create:');
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
  it('every worker declares a probe and a {prompt_file} command template', () => {
    const repo = makeTempDir('plandesk-factory-');
    runFactoryInit({ repoDir: repo });
    for (const name of ['claude', 'codex', 'cursor', 'grok', 'opencode']) {
      const content = readFileSync(join(repo, `.agents/factory/workers/${name}.md`), 'utf8');
      expect(content, name).toContain('type: worker');
      expect(content, name).toContain('probe: command -v ');
      expect(content, name).toContain('{prompt_file}');
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
