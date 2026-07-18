import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api.js';

/** App-wide QueryClient: fallback toast for mutations that do not define onError. */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
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
