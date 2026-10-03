import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '../lib/query-client.js';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveWorkspaceOverride } from '../lib/active-workspace.js';
import { routeTree } from '../routeTree.gen.js';
import { requestUrl } from '../test-utils.js';

const multiWorkspaceSession = {
  kind: 'loopback' as const,
  user_ref: null,
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: { id: 'ws-1', name: 'General' },
  workspaces: [
    { id: 'ws-1', name: 'General' },
    { id: 'ws-2', name: 'Other' },
  ],
};

const projectInOtherWorkspace = {
  id: 'proj-b',
  name: 'Cross-workspace Project',
  workspace_id: 'ws-2',
  description: null,
  summary: { scope: 0, todo: 0, in_progress: 0, done: 0, backlog: 0 },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => '' };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: 'not_found' }),
    text: () => Promise.resolve('not_found'),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('project URL owns workspace context', () => {
  it('deep-linking to a project in another workspace switches the active workspace and breadcrumb', async () => {
    setActiveWorkspaceOverride('ws-1');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith('/auth/session')) return ok(multiWorkspaceSession);
        if (url.endsWith('/workspaces'))
          return ok({ workspaces: multiWorkspaceSession.workspaces });
        if (url.endsWith('/projects')) return ok([projectInOtherWorkspace]);
        if (url.includes('/projects/proj-b') && !url.includes('/tasks') && !url.includes('/tags')) {
          return ok(projectInOtherWorkspace);
        }
        if (url.endsWith('/tasks')) return ok([]);
        if (url.endsWith('/tags')) return ok([]);
        return ok([]);
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/projects/proj-b/board'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Other' })).toBeTruthy();
    });
  });

  it('shows project not-found without retrying the project fetch', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/session')) return ok(multiWorkspaceSession);
      if (url.endsWith('/workspaces')) return ok({ workspaces: multiWorkspaceSession.workspaces });
      if (url.endsWith('/projects')) return ok([]);
      if (url.includes('/projects/missing') && !url.includes('/tasks') && !url.includes('/tags')) {
        return notFound();
      }
      if (url.endsWith('/tasks')) return ok([]);
      if (url.endsWith('/tags')) return ok([]);
      return ok([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    // The app's own client: the no-retry-on-404 rule is its default.
    const queryClient = createAppQueryClient();
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/projects/missing/board'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/This project doesn't exist or you don't have access to it/i),
      ).toBeTruthy();
    });

    const projectCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = requestUrl(input);
      return url.includes('/projects/missing') && !url.includes('/tasks') && !url.includes('/tags');
    });
    expect(projectCalls.length).toBe(1);
  });
});

describe('share portal layout', () => {
  it('renders /p/<token> without org app shell chrome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/share/test-token/meta')) {
          return ok({ audience_name: 'Guest', mode: 'public' });
        }
        return ok({});
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/test-token'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Guest' })).toBeTruthy();
    });

    expect(document.querySelector('[data-app-sidebar]')).toBeNull();
    expect(document.querySelector('[data-sidebar-trigger]')).toBeNull();
  });
});
