import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, getAuthMethods, getAuthSession, logout } from './api.js';

export const authSessionKey = ['auth', 'session'] as const;
export const authMethodsKey = ['auth', 'methods'] as const;

/**
 * The current session, or null when there is none.
 *
 * A 401 is the unauthenticated answer, not a failure: it resolves to null so
 * the UI shows sign-in instead of an error. Anything else still throws.
 */
export function useAuthSession() {
  return useQuery({
    queryKey: authSessionKey,
    queryFn: async () => {
      try {
        return await getAuthSession();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return null;
        }
        throw err;
      }
    },
    retry: false,
  });
}

/** Whether this instance offers GitHub sign-in or token entry only (REQ-20). */
export function useAuthMethods() {
  return useQuery({ queryKey: authMethodsKey, queryFn: getAuthMethods, retry: false });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // The cookie is gone; every cached org-scoped answer is now stale.
      await queryClient.invalidateQueries();
    },
  });
}
