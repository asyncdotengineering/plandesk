import { describe, expect, it } from 'vitest';
import {
  isValidCommitRef,
  isValidCommitRefs,
  MAX_COMMIT_REFS,
  MAX_COMMIT_REFS_RAW_LENGTH,
  normalizeCommitRef,
  normalizeCommitRefs,
  parseCommitRefs,
} from './commit-refs.js';

describe('isValidCommitRef', () => {
  it('accepts hex SHAs of length 7–40, case-insensitively', () => {
    expect(isValidCommitRef('abc1234')).toBe(true);
    expect(isValidCommitRef('ABC1234')).toBe(true);
    expect(isValidCommitRef('AbC1234')).toBe(true);
    expect(isValidCommitRef('deadbeef')).toBe(true);
    expect(isValidCommitRef('a'.repeat(40))).toBe(true);
  });

  it('rejects short, long, and non-hex', () => {
    expect(isValidCommitRef('abc123')).toBe(false);
    expect(isValidCommitRef('a'.repeat(41))).toBe(false);
    expect(isValidCommitRef('not-hex!')).toBe(false);
    expect(isValidCommitRef('')).toBe(false);
  });
});

describe('isValidCommitRefs', () => {
  it('requires every entry to be a valid ref and respects the max', () => {
    expect(isValidCommitRefs(['abc1234', 'deadbeef'])).toBe(true);
    expect(isValidCommitRefs(['ABC1234', 'DeadBeef'])).toBe(true);
    expect(isValidCommitRefs([])).toBe(true);
    expect(isValidCommitRefs(['abc1234', 'BAD!!!'])).toBe(false);
    const fifty = Array.from({ length: MAX_COMMIT_REFS }, (_, i) =>
      i.toString(16).padStart(7, '0'),
    );
    expect(isValidCommitRefs(fifty)).toBe(true);
    expect(isValidCommitRefs([...fifty, 'aaaaaaa'])).toBe(false);
  });
});

describe('normalizeCommitRefs', () => {
  it('lowercases without validating', () => {
    expect(normalizeCommitRef('ABC1234')).toBe('abc1234');
    expect(normalizeCommitRefs(['AbC1234', 'DEADBEEF'])).toEqual(['abc1234', 'deadbeef']);
  });
});

describe('parseCommitRefs', () => {
  it('parses a valid JSON array', () => {
    expect(parseCommitRefs(JSON.stringify(['abc1234', 'deadbeef']))).toEqual([
      'abc1234',
      'deadbeef',
    ]);
    expect(parseCommitRefs(null)).toEqual([]);
  });

  it('returns [] for over-length raw columns without throwing', () => {
    const oversized = 'x'.repeat(MAX_COMMIT_REFS_RAW_LENGTH + 1);
    expect(() => parseCommitRefs(oversized)).not.toThrow();
    expect(parseCommitRefs(oversized)).toEqual([]);
  });

  it('returns [] for corrupt JSON and non-array shapes', () => {
    expect(parseCommitRefs('{not-json')).toEqual([]);
    expect(parseCommitRefs('"just-a-string"')).toEqual([]);
    expect(parseCommitRefs(JSON.stringify([1, 2]))).toEqual([]);
  });
});
