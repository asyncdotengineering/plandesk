import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  it('throws instead of auto-creating an empty workspace.db (issue #4)', () => {
    const dataDir = makeTempDir();
    expect(() => openWorkspace(dataDir)).toThrow(WorkspaceNotFoundError);
    expect(existsSync(join(dataDir, 'workspace.db'))).toBe(false);
    expect(() => openWorkspace(dataDir)).toThrow(/plandesk init/);
  });

  it('names the connect binding when one is present', () => {
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
    expect(() => openWorkspace(dataDir)).toThrow(/connect binding \(http:\/\/127\.0\.0\.1:3456\)/);
    expect(existsSync(join(dataDir, 'workspace.db'))).toBe(false);
  });
});
