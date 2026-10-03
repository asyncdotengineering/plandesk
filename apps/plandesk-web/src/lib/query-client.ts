import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api.js';

/**
 * A 404 is an answer, not a transient failure: retrying a missing (or
 * not-yours) project only delays the not-found page by several seconds.
 */
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status === 404) && failureCount < 3;
}

/** App-wide QueryClient: fallback toast for mutations that do not define onError. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: retryUnlessNotFound } },
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.onError !== undefined) {
          return;
        }
        const msg =
          error instanceof ApiError && error.status === 403
            ? "You don't have permission to do that."
            : 'Something went wrong. Please try again.';
        toast.error(msg);
      },
    }),
  });
}
