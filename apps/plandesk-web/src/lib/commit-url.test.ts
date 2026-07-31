import { describe, expect, it } from 'vitest';
import { commitUrl } from './commit-url.js';

describe('commitUrl', () => {
  const sha = 'abc1234';

  it('links github.com https remotes', () => {
    expect(commitUrl('https://github.com/org/repo', sha)).toBe(
      'https://github.com/org/repo/commit/abc1234',
    );
  });

  it('normalises scp-style github remotes and strips .git', () => {
    expect(commitUrl('git@github.com:org/repo.git', sha)).toBe(
      'https://github.com/org/repo/commit/abc1234',
    );
  });

  it('links gitlab.com remotes', () => {
    expect(commitUrl('https://gitlab.com/org/repo', sha)).toBe(
      'https://gitlab.com/org/repo/commit/abc1234',
    );
  });

  it('returns null for unknown hosts (plain text, never a guessed URL)', () => {
    expect(commitUrl('https://git.example.com/repo', sha)).toBeNull();
  });

  it('returns null when repoUrl is missing', () => {
    expect(commitUrl(null, sha)).toBeNull();
    expect(commitUrl('', sha)).toBeNull();
  });
});
