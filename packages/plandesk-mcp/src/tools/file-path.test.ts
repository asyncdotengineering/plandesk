import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FILE_PATH_REMOTE_ERROR,
  readScopedFileBytes,
  resolveProjectScopedPath,
  xorPresent,
} from './file-path.js';

describe('file-path intake (Rule 14)', () => {
  it('xorPresent requires exactly one side', () => {
    expect(xorPresent('a', undefined)).toBe(true);
    expect(xorPresent(undefined, 'b')).toBe(true);
    expect(xorPresent('a', 'b')).toBe(false);
    expect(xorPresent(undefined, undefined)).toBe(false);
    expect(xorPresent('', 'b')).toBe(true);
  });

  it('resolves paths under the .plandesk project root and refuses escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      writeFileSync(join(root, 'screen.html'), '<p>hi</p>');
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'nested', 'a.png'), 'x');

      // Compare against the realpath'd root: containment is checked on real
      // paths, and on macOS a temp dir under /var realpaths to /private/var.
      const realRoot = realpathSync(root);
      expect(resolveProjectScopedPath('screen.html', root)).toBe(join(realRoot, 'screen.html'));
      expect(resolveProjectScopedPath(join(root, 'nested', 'a.png'), root)).toBe(
        join(realRoot, 'nested', 'a.png'),
      );
      expect(resolveProjectScopedPath('../outside', root)).toBeNull();
      expect(resolveProjectScopedPath('/etc/passwd', root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loopback reads bytes; remote bind refuses with the stated message', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from([1, 2, 3]));

      const ok = readScopedFileBytes(file, '127.0.0.1', root);
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
      }

      const remote = readScopedFileBytes(file, '0.0.0.0', root);
      expect(remote.ok).toBe(false);
      if (!remote.ok) {
        const text = remote.error.content[0]?.text ?? '';
        expect(text).toContain(FILE_PATH_REMOTE_ERROR);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a path outside the project even on loopback', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    const other = mkdtempSync(join(tmpdir(), 'pd-other-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const secret = join(other, 'secret.txt');
      writeFileSync(secret, 'nope');
      const result = readScopedFileBytes(secret, '127.0.0.1', root);
      expect(result.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  // Both of the following were exploitable: each returned real bytes from
  // outside the project on a loopback bind. An agent writes files into the
  // repo as a matter of course, so planting a symlink is not an obstacle.

  it('refuses a symlink inside the project that points outside it', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    const outside = mkdtempSync(join(tmpdir(), 'pd-secret-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      const secret = join(outside, 'id_rsa');
      writeFileSync(secret, '-----BEGIN PRIVATE KEY-----');

      // Looks like an ordinary screenshot living in the project.
      const link = join(root, 'screenshot.png');
      symlinkSync(secret, link);

      expect(resolveProjectScopedPath(link, root)).toBeNull();
      expect(readScopedFileBytes(link, '127.0.0.1', root).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked parent directory that escapes the project', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-fpath-'));
    const outside = mkdtempSync(join(tmpdir(), 'pd-secret-'));
    try {
      mkdirSync(join(root, '.plandesk'));
      writeFileSync(join(outside, 'notes.md'), 'secret');

      // The *directory* is the link, so the leaf name looks contained.
      symlinkSync(outside, join(root, 'assets'));

      expect(resolveProjectScopedPath(join(root, 'assets', 'notes.md'), root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // Declared capability, pinned deliberately rather than left implicit: a file
  // under ANOTHER local Plan Desk project resolves, because a workspace
  // legitimately spans repos and the server's cwd is not necessarily the
  // project being attached to. Whether that reach should be narrowed is a
  // product decision, filed separately — this test exists so a future change
  // to it is a choice rather than an accident.
  it("accepts a file under a different local project's .plandesk root", () => {
    const mine = mkdtempSync(join(tmpdir(), 'pd-mine-'));
    const theirs = mkdtempSync(join(tmpdir(), 'pd-theirs-'));
    try {
      mkdirSync(join(mine, '.plandesk'));
      mkdirSync(join(theirs, '.plandesk'));
      const theirFile = join(theirs, 'private.txt');
      writeFileSync(theirFile, 'ANOTHER PROJECT');

      expect(resolveProjectScopedPath(theirFile, mine)).toBe(
        join(realpathSync(theirs), 'private.txt'),
      );
    } finally {
      rmSync(mine, { recursive: true, force: true });
      rmSync(theirs, { recursive: true, force: true });
    }
  });

  // A directory with no .plandesk anywhere above it has no root to borrow, so
  // it falls back to the caller's project and is refused.
  it('refuses a file in a directory that is not a Plan Desk project', () => {
    const mine = mkdtempSync(join(tmpdir(), 'pd-mine-'));
    const nowhere = mkdtempSync(join(tmpdir(), 'pd-nowhere-'));
    try {
      mkdirSync(join(mine, '.plandesk'));
      const stray = join(nowhere, 'stray.txt');
      writeFileSync(stray, 'no project here');

      expect(resolveProjectScopedPath(stray, mine)).toBeNull();
      expect(readScopedFileBytes(stray, '127.0.0.1', mine).ok).toBe(false);
    } finally {
      rmSync(mine, { recursive: true, force: true });
      rmSync(nowhere, { recursive: true, force: true });
    }
  });
});
