import { describe, expect, it } from 'vitest';
import { version } from './index.js';

describe('@plandesk/db', () => {
  it('returns the package version', () => {
    expect(version()).toBe('0.0.0');
  });
});
