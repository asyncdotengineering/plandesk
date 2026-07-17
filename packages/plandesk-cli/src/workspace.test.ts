import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID, createDb, migrate } from '@plandesk/db';
import { openWorkspace, WorkspaceNotFoundError } from './workspace.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plandesk-ws-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('openWorkspace on a missing database', () => {
  it('throws instead of auto-creating an empty workspace.db (issue #4)', async () => {
    const dataDir = makeTempDir();
    await expect(openWorkspace(dataDir)).rejects.toThrow(WorkspaceNotFoundError);
    expect(existsSync(join(dataDir, 'workspace.db'))).toBe(false);
    await expect(openWorkspace(dataDir)).rejects.toThrow(/plandesk init/);
  });

  it('names the connect binding when one is present', async () => {
    const dataDir = makeTempDir();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({
        version: 'plandesk-connect-v1',
        serverUrl: 'http://127.0.0.1:3456',
        projectId: 'p1',
        projectName: 'demo',
      }),
      'utf8',
    );
    await expect(openWorkspace(dataDir)).rejects.toThrow(
      /connect binding \(http:\/\/127\.0\.0\.1:3456\)/,
    );
    expect(existsSync(join(dataDir, 'workspace.db'))).toBe(false);
  });
});

describe('openWorkspace migrations', () => {
  it('creates Better Auth tables for an existing pre-identity workspace', async () => {
    const dataDir = makeTempDir();
    const dbPath = join(dataDir, 'workspace.db');
    const legacyDb = await createDb(dbPath);
    await migrate(legacyDb);
        legacyDb.$client.close();

    const { db } = await openWorkspace(dataDir);
    const tables = await db.$client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organization', 'user', 'account')",
    );
    expect(new Set(tables.rows.map((row) => row.name))).toEqual(
      new Set(['account', 'organization', 'user']),
    );
    db.$client.close();
  });
});
