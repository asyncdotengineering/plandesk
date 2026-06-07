import { describe, expect, it } from 'vitest';
import { version } from './index.js';

describe('@plandesk/mcp-client', () => {
  it('returns the package version', () => {
    expect(version()).toBe('0.0.0');
  });

  it('rejects an empty version string', () => {
    expect(version()).not.toBe('');
  });
});
