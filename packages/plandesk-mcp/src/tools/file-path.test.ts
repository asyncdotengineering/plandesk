import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FILE_PATH_OUTSIDE_WORKSPACE_ERROR,
  FILE_PATH_REMOTE_ERROR,
  readScopedFileBytes,
  resolveProjectScopedPath,
  xorPresent,
  type WorkspaceRootsResolver,
} from './file-path.js';

function rootsOf(...dirs: string[]): WorkspaceRootsResolver {
  const resolved = dirs.map((dir) => realpathSync(dir));
  return () => Promise.resolve(resolved);
}

describe('file-path intake (Rule 14)', () => {
  it('xorPresent requires exactly one side', () => {
    expect(xorPresent('a', undefined)).toBe(true);
    expect(xorPresent(undefined, 'b')).toBe(true);
    expect(xorPresent('a', 'b')).toBe(false);
    expect(xorPresent(undefined, undefined)).toBe(false);
    expect(xorPresent('', 'b')).toBe(true);
  });

  it('resolves paths under registered workspace roots and refuses escapes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      writeFileSync(join(root, 'screen.html'), '<p>hi</p>');
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'nested', 'a.png'), 'x');

      const realRoot = realpathSync(root);
      const workspaceRoots = rootsOf(root);
      expect(await resolveProjectScopedPath('screen.html', workspaceRoots, root)).toBe(
        join(realRoot, 'screen.html'),
      );
      expect(await resolveProjectScopedPath(join(root, 'nested', 'a.png'), workspaceRoots, root)).toBe(
        join(realRoot, 'nested', 'a.png'),
      );
      expect(await resolveProjectScopedPath('../outside', workspaceRoots, root)).toBeNull();
      expect(await resolveProjectScopedPath('/etc/passwd', workspaceRoots, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loopback reads bytes; remote bind refuses with the stated message', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from([1, 2, 3]));

      const workspaceRoots = rootsOf(root);
      const ok = await readScopedFileBytes(file, '127.0.0.1', { workspaceRoots, cwd: root });
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
      }

      const remote = await readScopedFileBytes(file, '0.0.0.0', { workspaceRoots, cwd: root });
      expect(remote.ok).toBe(false);
      if (!remote.ok) {
        const text = remote.error.content[0]?.text ?? '';
        expect(text).toContain(FILE_PATH_REMOTE_ERROR);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a path outside registered workspace roots even on loopback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    const other = mkdtempSync(join(tmpdir(), 'pd-other-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const secret = join(other, 'secret.txt');
      writeFileSync(secret, 'nope');
      const result = await readScopedFileBytes(secret, '127.0.0.1', {
        workspaceRoots: rootsOf(root),
        cwd: root,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.content[0]?.text ?? '').toContain(FILE_PATH_OUTSIDE_WORKSPACE_ERROR);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('refuses a symlink inside the project that points outside it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    const outside = mkdtempSync(join(tmpdir(), 'pd-secret-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const secret = join(outside, 'id_rsa');
      writeFileSync(secret, '-----BEGIN PRIVATE KEY-----');

      const link = join(root, 'screenshot.png');
      symlinkSync(secret, link);

      const workspaceRoots = rootsOf(root);
      expect(await resolveProjectScopedPath(link, workspaceRoots, root)).toBeNull();
      expect((await readScopedFileBytes(link, '127.0.0.1', { workspaceRoots, cwd: root })).ok).toBe(
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked parent directory that escapes the project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    const outside = mkdtempSync(join(tmpdir(), 'pd-secret-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      writeFileSync(join(outside, 'notes.md'), 'secret');

      symlinkSync(outside, join(root, 'assets'));

      const workspaceRoots = rootsOf(root);
      expect(
        await resolveProjectScopedPath(join(root, 'assets', 'notes.md'), workspaceRoots, root),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('accepts a workspace-registered project root and refuses a Plan Desk project outside it', async () => {
    const inWorkspace = mkdtempSync(join(tmpdir(), 'pd-in-ws-'));
    const outsideWorkspace = mkdtempSync(join(tmpdir(), 'pd-out-ws-'));
    try {
      mkdirSync(join(inWorkspace, '.plandesk'));
      mkdirSync(join(outsideWorkspace, '.plandesk'));
      const insideFile = join(inWorkspace, 'inside.txt');
      const outsideFile = join(outsideWorkspace, 'outside.txt');
      writeFileSync(insideFile, 'IN');
      writeFileSync(outsideFile, 'OUT');

      const workspaceRoots = rootsOf(inWorkspace);

      expect(await resolveProjectScopedPath(insideFile, workspaceRoots)).toBe(
        join(realpathSync(inWorkspace), 'inside.txt'),
      );
      expect(await resolveProjectScopedPath(outsideFile, workspaceRoots)).toBeNull();

      const readOutside = await readScopedFileBytes(outsideFile, '127.0.0.1', { workspaceRoots });
      expect(readOutside.ok).toBe(false);
      if (!readOutside.ok) {
        expect(readOutside.error.content[0]?.text ?? '').toContain(FILE_PATH_OUTSIDE_WORKSPACE_ERROR);
      }
    } finally {
      rmSync(inWorkspace, { recursive: true, force: true });
      rmSync(outsideWorkspace, { recursive: true, force: true });
    }
  });

  it('refuses a file in a directory that is not a registered workspace root', async () => {
    const registered = mkdtempSync(join(tmpdir(), 'pd-mine-'));
    const nowhere = mkdtempSync(join(tmpdir(), 'pd-nowhere-'));
    try {
      mkdirSync(join(registered, '.plandesk'));
      const stray = join(nowhere, 'stray.txt');
      writeFileSync(stray, 'no project here');

      const workspaceRoots = rootsOf(registered);
      expect(await resolveProjectScopedPath(stray, workspaceRoots, registered)).toBeNull();
      expect(
        (await readScopedFileBytes(stray, '127.0.0.1', { workspaceRoots, cwd: registered })).ok,
      ).toBe(false);
    } finally {
      rmSync(registered, { recursive: true, force: true });
      rmSync(nowhere, { recursive: true, force: true });
    }
  });
});
