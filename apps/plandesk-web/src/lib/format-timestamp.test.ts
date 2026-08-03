import { describe, expect, it } from 'vitest';
import {
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
} from './format-timestamp.js';

describe('formatRelativeTimestamp', () => {
  const now = Date.parse('2026-08-03T12:00:00.000Z');

  it('renders relative buckets', () => {
    expect(formatRelativeTimestamp('2026-08-03T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelativeTimestamp('2026-08-03T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatRelativeTimestamp('2026-08-03T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeTimestamp('2026-08-01T12:00:00.000Z', now)).toBe('2d ago');
  });
});

describe('formatAbsoluteTimestamp', () => {
  it('returns a locale string for valid ISO input', () => {
    const formatted = formatAbsoluteTimestamp('2026-08-03T12:00:00.000Z');
    expect(formatted).toContain('2026');
  });
});
