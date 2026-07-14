import { describe, expect, it } from 'vitest';
import { LIVE_QUERY_POLL_MS, liveQueryOptions } from './events.js';

describe('live query polling options', () => {
  it('polls at 2.5s and refetches on window focus', () => {
    expect(LIVE_QUERY_POLL_MS).toBe(2500);
    expect(LIVE_QUERY_POLL_MS).toBeGreaterThanOrEqual(1000);
    expect(liveQueryOptions).toEqual({
      refetchInterval: 2500,
      refetchOnWindowFocus: true,
    });
  });
});
