import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getAuthMethods,
  getAuthSession,
  listWorkspaces,
  logout,
  setActiveOrganization,
  setActiveWorkspace,
  type Workspace,
} from './api.js';
import { setActiveWorkspaceOverride, useActiveWorkspaceOverride } from './active-workspace.js';

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
    mutationFn: async (teamId: string) => {
      // Set the client-side active first so a loopback board (which has no
      // session to persist the active team) switches immediately; then persist
      // server-side for a real session (a loopback 401 is swallowed in the api).
      setActiveWorkspaceOverride(teamId);
      await setActiveWorkspace(teamId);
    },
    onSuccess: async () => {
      // The active workspace drives the projects-home filter and the switcher;
      // a full invalidate is the same posture as switching orgs.
      await queryClient.invalidateQueries();
    },
  });
}

/**
 * The effective active workspace. A local (loopback) board can't persist the
 * active team server-side, so a client-side override drives the selection; it
 * falls back to the session's server-computed active workspace.
 */
export function useActiveWorkspace(): Workspace | null {
  const override = useActiveWorkspaceOverride();
  const { data: session } = useAuthSession();
  const workspaces = session?.workspaces ?? [];
  if (override !== null) {
    const match = workspaces.find((workspace) => workspace.id === override);
    if (match !== undefined) {
      return match;
    }
  }
  return session?.active_workspace ?? null;
}

/** The active org's workspaces, straight from better-auth (fresh list for CRUD). */
export function useWorkspaces() {
  return useQuery({ queryKey: workspacesKey, queryFn: listWorkspaces });
}
