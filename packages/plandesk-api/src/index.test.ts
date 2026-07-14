import { describe, expect, it } from 'vitest';
import { version } from './index.js';

describe('@plandesk/api', () => {
  it('returns the package version', async () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects an empty version string', async () => {
    expect(version()).not.toBe('');
  });
});
