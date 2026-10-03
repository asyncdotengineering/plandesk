import { describe, expect, it } from 'vitest';
import {
  isValidRepoRelativePath,
  isValidRegisteredRepoRoot,
  isValidRepoUrl,
  resolvedPathStaysUnderRoot,
} from './project-binding.js';

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

describe('isValidRepoRelativePath', () => {
  it('accepts relative paths without traversal', () => {
    expect(isValidRepoRelativePath('packages/plandesk-api')).toBe(true);
    expect(isValidRepoRelativePath('apps/web')).toBe(true);
    expect(isValidRepoRelativePath('single')).toBe(true);
  });

  it('rejects absolute, traversal, empty segments, and slash edges', () => {
    expect(isValidRepoRelativePath('/etc')).toBe(false);
    expect(isValidRepoRelativePath('/etc/passwd')).toBe(false);
    expect(isValidRepoRelativePath('C:\\Windows')).toBe(false);
    expect(isValidRepoRelativePath('C:/Windows')).toBe(false);
    expect(isValidRepoRelativePath('\\\\server\\share')).toBe(false);
    expect(isValidRepoRelativePath('//server/share')).toBe(false);
    expect(isValidRepoRelativePath('../../other')).toBe(false);
    expect(isValidRepoRelativePath('a/../b')).toBe(false);
    expect(isValidRepoRelativePath('a//b')).toBe(false);
    expect(isValidRepoRelativePath('/leading')).toBe(false);
    expect(isValidRepoRelativePath('trailing/')).toBe(false);
    expect(isValidRepoRelativePath('')).toBe(false);
  });

  it('rejects every Windows drive prefix, including drive-relative forms', () => {
    // Drive-relative: path.win32.resolve(repoRoot, 'C:..\\secret') escapes the root.
    expect(isValidRepoRelativePath('C:..\\secret')).toBe(false);
    expect(isValidRepoRelativePath('C:relative\\path')).toBe(false);
    expect(isValidRepoRelativePath('C:\\abs')).toBe(false);
    expect(isValidRepoRelativePath('c:..')).toBe(false);
    expect(isValidRepoRelativePath('packages/plandesk-api')).toBe(true);
  });
});

describe('isValidRegisteredRepoRoot', () => {
  it('accepts absolute paths and rejects relative monorepo paths', () => {
    expect(isValidRegisteredRepoRoot('/Users/dev/my-repo')).toBe(true);
    expect(isValidRegisteredRepoRoot('packages/plandesk-api')).toBe(false);
    expect(isValidRegisteredRepoRoot('/tmp/../etc')).toBe(false);
  });
});

describe('isValidRepoRelativePath', () => {
  it('matches folder path policy', () => {
    expect(isValidRepoRelativePath('docs/spec.md')).toBe(true);
    expect(isValidRepoRelativePath('../escape.md')).toBe(false);
  });
});

describe('resolvedPathStaysUnderRoot', () => {
  it('rejects paths that resolve outside the root', () => {
    expect(resolvedPathStaysUnderRoot('/tmp/repo', 'docs/a.md')).toBe(true);
    expect(resolvedPathStaysUnderRoot('/tmp/repo', '../outside.md')).toBe(false);
  });
});
