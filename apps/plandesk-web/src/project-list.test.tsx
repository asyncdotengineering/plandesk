import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.gen.js';

const sampleProject = {
  id: 'proj-1',
  name: 'Alpha',
  description: 'First project',
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

/** The board renders behind AuthGate, so every request needs an auth answer. */
const localSession = {
  kind: 'loopback' as const,
  user_ref: null,
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Personal' },
  orgs: [{ id: 'org-1', name: 'Personal', role: 'owner' }],
};

function stubFetch(projects: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.endsWith('/auth/session')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(localSession) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(projects) });
    }),
  );
}

/** Loopback session that also carries an active workspace + workspaces list. */
const localSessionWithWorkspace = {
  ...localSession,
  active_workspace: { id: 'ws-1', name: 'General' },
  workspaces: [
    { id: 'ws-1', name: 'General' },
    { id: 'ws-2', name: 'Fiji TV' },
  ],
};

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Project list', () => {
  it('renders projects from GET /projects', async () => {
    stubFetch([sampleProject]);

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
    });

    expect(screen.getByRole('link', { name: /Alpha/ })).toBeTruthy();
    expect(screen.getByText('First project')).toBeTruthy();
  });

  it('shows empty state when no projects', async () => {
    stubFetch([]);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeTruthy();
    });
  });

  it('shows only the active workspace\'s projects (REQ-C2)', async () => {
    const inWorkspace = {
      id: 'proj-ws1',
      name: 'In Workspace',
      description: null,
      workspace_id: 'ws-1',
      created_at: '2026-06-07T00:00:00.000Z',
      updated_at: '2026-06-07T00:00:00.000Z',
    };
    const otherWorkspace = {
      id: 'proj-ws2',
      name: 'Other Workspace',
      description: null,
      workspace_id: 'ws-2',
      created_at: '2026-06-07T00:00:00.000Z',
      updated_at: '2026-06-07T00:00:00.000Z',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        if (url.endsWith('/auth/session')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(localSessionWithWorkspace),
          });
        }
        // Every other GET (incl. /projects) returns both projects; the filter
        // is client-side, so both must be present pre-filter.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([inWorkspace, otherWorkspace]),
        });
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /In Workspace/ })).toBeTruthy();
    });
    // The other workspace's project is filtered out client-side.
    expect(screen.queryByText('Other Workspace')).toBeNull();
  });
});
