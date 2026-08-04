import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen.js';
import { requestUrl } from '../test-utils.js';

const session = {
  kind: 'loopback' as const,
  user_ref: null,
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: { id: 'ws-1', name: 'General' },
  workspaces: [{ id: 'ws-1', name: 'General' }],
};

const project = {
  id: 'proj-1',
  name: 'Smoke Project',
  workspace_id: 'ws-1',
  description: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => '' };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/session')) return ok(session);
      if (url.endsWith('/workspaces')) return ok({ workspaces: session.workspaces });
      if (url.endsWith('/projects')) return ok([project]);
      if (url.includes('/projects/proj-1') && !url.includes('/tasks') && !url.includes('/tags')) {
        return ok(project);
      }
      if (url.endsWith('/tasks')) return ok([]);
      if (url.endsWith('/tags')) return ok([]);
      return { ok: true, status: 200, json: () => Promise.resolve([]), text: () => '' };
    }),
  );
}

function renderBoard() {
  stubFetch();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/projects/proj-1/board'] }),
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('breadcrumb link targets', () => {
  it('workspace crumb links to / (workspace landing)', async () => {
    renderBoard();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'General' })).toBeTruthy();
    });

    const workspaceCrumb = screen.getByRole('link', { name: 'General' });
    expect(workspaceCrumb.getAttribute('href')).toBe('/');
  });

  // The assertion this test exists for is that the crumb goes *into* the project
  // rather than back to the workspace landing. The project's own landing view is
  // the board — opening a project should show the work, not a summary of it.
  it('project crumb links to the project board, not workspace landing', async () => {
    const { router } = renderBoard();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Smoke Project' })).toBeTruthy();
    });

    const projectCrumb = screen.getByRole('link', { name: 'Smoke Project' });
    expect(projectCrumb.getAttribute('href')).toContain('/board');

    fireEvent.click(projectCrumb);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/projects/proj-1/board');
    });
  });
});
