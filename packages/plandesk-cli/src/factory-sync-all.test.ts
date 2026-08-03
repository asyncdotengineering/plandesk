import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate, createProjectInDefaultOrg, updateProject } from '@plandesk/db';
import {
  discoverPlandeskRepos,
  formatFactorySyncAllSummary,
  resolveRegisteredRepoRoots,
  runFactorySyncAll,
} from './factory-sync-all.js';

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A directory that looks like a repo bound to `projectId`. */
function boundRepo(root: string, projectId: string): string {
  mkdirSync(join(root, '.plandesk'), { recursive: true });
  writeFileSync(
    join(root, '.plandesk', 'config.json'),
    JSON.stringify({ version: 'plandesk-connect-v1', serverUrl: 'http://x', projectId, projectName: 'p' }),
    'utf8',
  );
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('discoverPlandeskRepos', () => {
  it('finds bound repos and ignores dependency trees', () => {
    const root = tmp('plandesk-scan-');
    boundRepo(join(root, 'alpha'), 'p1');
    boundRepo(join(root, 'nested', 'beta'), 'p2');
    // A checkout vendored inside node_modules is not a project anybody wants swept.
    boundRepo(join(root, 'app', 'node_modules', 'gamma'), 'p3');

    const found = discoverPlandeskRepos(root);

    // Compare against realpath-resolved paths: discovery normalises to match
    // what the registry stores, and on macOS a /tmp temp dir is a symlink.
    expect(found).toContain(realpathSync(join(root, 'alpha')));
    expect(found).toContain(realpathSync(join(root, 'nested', 'beta')));
    expect(found.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('normalises discovered paths so one repo is not swept under two spellings', () => {
    const root = tmp('plandesk-norm-');
    boundRepo(join(root, 'alpha'), 'p1');
    // The registry stores realpath-resolved roots; discovery must agree or the
    // union of "registered" and "discovered" double-counts the same repo.
    for (const found of discoverPlandeskRepos(root)) {
      expect(found).toBe(realpathSync(found));
    }
  });

  it('stops at the depth bound instead of walking a whole home directory', () => {
    const root = tmp('plandesk-depth-');
    boundRepo(join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'deep'), 'p1');

    expect(discoverPlandeskRepos(root, 2)).toEqual([]);
  });
});

describe('resolveRegisteredRepoRoots', () => {
  it('dedupes registered roots and drops unregistered projects', async () => {
    const dataDir = tmp('plandesk-roots-');
    const db = await createDb(join(dataDir, 'workspace.db'));
    await migrate(db);

    const shared = tmp('plandesk-shared-');
    const a = await createProjectInDefaultOrg(db, { name: 'a' });
    const b = await createProjectInDefaultOrg(db, { name: 'b' });
    await createProjectInDefaultOrg(db, { name: 'unregistered' });
    // Two projects can legitimately bind the same repo root; the sweep must
    // visit it once, not once per project.
    await updateProject(db, a.id, { folderPath: shared });
    await updateProject(db, b.id, { folderPath: shared });

    expect(await resolveRegisteredRepoRoots(db)).toEqual([shared]);
  });
});

describe('runFactorySyncAll', () => {
  it('skips a root that is no longer on disk instead of failing the sweep', async () => {
    const dataDir = tmp('plandesk-sweep-');
    const db = await createDb(join(dataDir, 'workspace.db'));
    await migrate(db);

    const alive = tmp('plandesk-alive-');
    const gone = join(tmpdir(), 'plandesk-definitely-not-here-12345');
    const p1 = await createProjectInDefaultOrg(db, { name: 'alive' });
    const p2 = await createProjectInDefaultOrg(db, { name: 'gone' });
    await updateProject(db, p1.id, { folderPath: alive });
    await updateProject(db, p2.id, { folderPath: gone });

    const result = await runFactorySyncAll({ dataDir });

    expect(result.considered).toBe(2);
    const missing = result.outcomes.find((o) => o.root === gone);
    expect(missing?.status).toBe('skipped');
    // The surviving root still got swept — one bad entry does not end the run.
    expect(result.outcomes.find((o) => o.root === alive)?.status).toBe('synced');
  });

  it('registers discovered repos with --scan so later sweeps need no scan', async () => {
    const dataDir = tmp('plandesk-bootstrap-');
    const dbPath = join(dataDir, 'workspace.db');
    const db = await createDb(dbPath);
    await migrate(db);

    const project = await createProjectInDefaultOrg(db, { name: 'discovered' });
    const scanRoot = tmp('plandesk-scanroot-');
    boundRepo(join(scanRoot, 'repo'), project.id);

    // Nothing registered yet, so a bare sweep has nothing to do.
    expect(await resolveRegisteredRepoRoots(db)).toEqual([]);

    const result = await runFactorySyncAll({ dataDir, scan: scanRoot, write: true });

    expect(result.registered).toHaveLength(1);
    expect(result.considered).toBe(1);
    // The registry is now correct, so the next run finds it without scanning.
    const after = await createDb(dbPath);
    expect(await resolveRegisteredRepoRoots(after)).toHaveLength(1);
  });

  it('does not record roots on a dry run, but still previews them', async () => {
    const dataDir = tmp('plandesk-dryscan-');
    const dbPath = join(dataDir, 'workspace.db');
    const db = await createDb(dbPath);
    await migrate(db);

    const project = await createProjectInDefaultOrg(db, { name: 'discovered' });
    const scanRoot = tmp('plandesk-dryscanroot-');
    boundRepo(join(scanRoot, 'repo'), project.id);

    const result = await runFactorySyncAll({ dataDir, scan: scanRoot });

    // Previewed, so the user can see what a --write would touch...
    expect(result.considered).toBe(1);
    expect(result.registered).toEqual([]);
    // ...but nothing was persisted: a dry run that mutates is not a dry run.
    const after = await createDb(dbPath);
    expect(await resolveRegisteredRepoRoots(after)).toEqual([]);
  });
});

describe('formatFactorySyncAllSummary', () => {
  it('explains an empty registry rather than reporting a silent success', () => {
    const out = formatFactorySyncAllSummary({ considered: 0, registered: [], outcomes: [] });

    expect(out).toContain('No project on this board has a registered repo root');
    expect(out).toContain('--scan');
    expect(out).not.toContain('0 synced, 0 skipped');
  });

  it('marks a dry run so a reader does not think files were written', () => {
    const out = formatFactorySyncAllSummary(
      { considered: 1, registered: [], outcomes: [{ root: '/x', status: 'skipped', reason: 'no longer on disk' }] },
      { write: false },
    );

    expect(out).toContain('Dry run');
  });
});
