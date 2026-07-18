import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getAuthMethods,
  getAuthSession,
  listWorkspaces,
  logout,
  setActiveOrganization,
  setActiveWorkspace,
} from './api.js';

export const authSessionKey = ['auth', 'session'] as const;
export const authMethodsKey = ['auth', 'methods'] as const;
export const workspacesKey = ['workspaces'] as const;

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

export function useSetActiveOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setActiveOrganization,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
}

/** Switch the active workspace (better-auth team); invalidates org-scoped reads. */
export function useSetActiveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setActiveWorkspace,
    onSuccess: async () => {
      // The active workspace drives the projects-home filter and the switcher;
      // a full invalidate is the same posture as switching orgs.
      await queryClient.invalidateQueries();
    },
  });
}

/** The active org's workspaces, straight from better-auth (fresh list for CRUD). */
export function useWorkspaces() {
  return useQuery({ queryKey: workspacesKey, queryFn: listWorkspaces });
}
