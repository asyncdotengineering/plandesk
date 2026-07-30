import { describe, expect, it } from 'vitest';
import { isValidFolderPath, isValidRepoUrl } from './project-binding.js';

describe('isValidRepoUrl', () => {
  it('accepts http(s), ssh, git, and scp-style remotes', () => {
    expect(isValidRepoUrl('https://github.com/acme/plandesk')).toBe(true);
    expect(isValidRepoUrl('http://example.com/repo.git')).toBe(true);
    expect(isValidRepoUrl('ssh://git@github.com/acme/plandesk.git')).toBe(true);
    expect(isValidRepoUrl('git://github.com/acme/plandesk.git')).toBe(true);
    expect(isValidRepoUrl('git@github.com:acme/plandesk.git')).toBe(true);
  });

  it('rejects dangerous and unknown schemes', () => {
    expect(isValidRepoUrl('javascript:alert(1)')).toBe(false);
    expect(isValidRepoUrl('data:text/html,<script>')).toBe(false);
    expect(isValidRepoUrl('file:///etc/passwd')).toBe(false);
    expect(isValidRepoUrl('vbscript:MsgBox(1)')).toBe(false);
    expect(isValidRepoUrl('ftp://example.com/repo.git')).toBe(false);
    expect(isValidRepoUrl('not-a-url')).toBe(false);
    expect(isValidRepoUrl('')).toBe(false);
  });

  it('rejects scp-style remotes whose user component begins a URI scheme', () => {
    // No `://`, so these take the scp branch — but `new URL(...)` on the
    // stored string resolves javascript:/data:/file: and becomes a live href.
    expect(isValidRepoUrl('javascript:alert@github.com:org/repo.git')).toBe(false);
    expect(isValidRepoUrl('data:text,owned@github.com:org/repo.git')).toBe(false);
    expect(isValidRepoUrl('file:C:@github.com:org/repo.git')).toBe(false);
    expect(isValidRepoUrl('git@github.com:org/repo.git')).toBe(true);
  });
});

describe('isValidFolderPath', () => {
  it('accepts relative paths without traversal', () => {
    expect(isValidFolderPath('packages/plandesk-api')).toBe(true);
    expect(isValidFolderPath('apps/web')).toBe(true);
    expect(isValidFolderPath('single')).toBe(true);
  });

  it('rejects absolute, traversal, empty segments, and slash edges', () => {
    expect(isValidFolderPath('/etc')).toBe(false);
    expect(isValidFolderPath('/etc/passwd')).toBe(false);
    expect(isValidFolderPath('C:\\Windows')).toBe(false);
    expect(isValidFolderPath('C:/Windows')).toBe(false);
    expect(isValidFolderPath('\\\\server\\share')).toBe(false);
    expect(isValidFolderPath('//server/share')).toBe(false);
    expect(isValidFolderPath('../../other')).toBe(false);
    expect(isValidFolderPath('a/../b')).toBe(false);
    expect(isValidFolderPath('a//b')).toBe(false);
    expect(isValidFolderPath('/leading')).toBe(false);
    expect(isValidFolderPath('trailing/')).toBe(false);
    expect(isValidFolderPath('')).toBe(false);
  });

  it('rejects every Windows drive prefix, including drive-relative forms', () => {
    // Drive-relative: path.win32.resolve(repoRoot, 'C:..\\secret') escapes the root.
    expect(isValidFolderPath('C:..\\secret')).toBe(false);
    expect(isValidFolderPath('C:relative\\path')).toBe(false);
    expect(isValidFolderPath('C:\\abs')).toBe(false);
    expect(isValidFolderPath('c:..')).toBe(false);
    expect(isValidFolderPath('packages/plandesk-api')).toBe(true);
  });
});
