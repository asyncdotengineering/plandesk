import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { checkpointWalForFileCopy } from './wal-file-copy.js';

describe('checkpointWalForFileCopy', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'plandesk-wal-copy-'));
    tempDirs.push(dir);
    return join(dir, 'workspace.db');
  }

  it('raw copyFileSync of the .db alone loses WAL data (the bug legacy-upgrade had)', async () => {
    const sourcePath = tempDbPath();
    const sourceDb = await createDb(sourcePath);
    await sourceDb.$client.execute('CREATE TABLE t (id TEXT PRIMARY KEY, label TEXT NOT NULL)');
    await sourceDb.$client.execute({
      sql: 'INSERT INTO t (id, label) VALUES (?, ?)',
      args: ['important-legacy-row', 'important-legacy-row'],
    });
    expect(existsSync(`${sourcePath}-wal`)).toBe(true);

    const backupPath = `${sourcePath}.raw-copy`;
    copyFileSync(sourcePath, backupPath);
    sourceDb.$client.close();

    const backupDb = await createDb(backupPath);
    try {
      await expect(backupDb.$client.execute('SELECT id FROM t')).rejects.toThrow();
    } finally {
      backupDb.$client.close();
    }
  });

  it('produces a self-contained .db copy after WAL writes (legacy-upgrade backup shape)', async () => {
    const sourcePath = tempDbPath();
    const sourceDb = await createDb(sourcePath);
    await sourceDb.$client.execute('CREATE TABLE t (id TEXT PRIMARY KEY, label TEXT NOT NULL)');
    await sourceDb.$client.execute({
      sql: 'INSERT INTO t (id, label) VALUES (?, ?)',
      args: ['important-legacy-row', 'important-legacy-row'],
    });

    const walPath = `${sourcePath}-wal`;
    expect(existsSync(walPath)).toBe(true);

    const backupPath = `${sourcePath}.backup`;
    await checkpointWalForFileCopy(sourceDb.$client);
    copyFileSync(sourcePath, backupPath);
    sourceDb.$client.close();

    const backupDb = await createDb(backupPath);
    try {
      const rows = await backupDb.$client.execute('SELECT id, label FROM t');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.['id']).toBe('important-legacy-row');
      expect(rows.rows[0]?.['label']).toBe('important-legacy-row');
    } finally {
      backupDb.$client.close();
    }
  });
});
