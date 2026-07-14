/** Poll interval for live-ish board data (replaces SSE). Never sub-second. */
export const LIVE_QUERY_POLL_MS = 2500;

/** Shared TanStack Query options for queries that previously relied on SSE invalidation. */
export const liveQueryOptions = {
  refetchInterval: LIVE_QUERY_POLL_MS,
  refetchOnWindowFocus: true as const,
};
