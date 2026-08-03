import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRegisteredRepoRoot } from './repo-root.js';

describe('resolveRegisteredRepoRoot', () => {
  it('returns an absolute realpath', () => {
    const root = resolveRegisteredRepoRoot('.');
    expect(root).toBe(realpathSync(resolve('.')));
  });
});
