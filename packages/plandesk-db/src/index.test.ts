import { describe, expect, it } from 'vitest';
import { version } from './index.js';

describe('@plandesk/db', () => {
  it('returns the package version', () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
