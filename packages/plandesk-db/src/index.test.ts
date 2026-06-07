import { describe, expect, it } from 'vitest';
import { sqliteAvailable, version } from './index.js';

describe('@plandesk/db', () => {
  it('returns the package version', () => {
    expect(version()).toBe('0.0.0');
  });

  it('loads better-sqlite3 in memory', () => {
    expect(sqliteAvailable()).toBe(true);
  });
});
