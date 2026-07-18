import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.gen.js';

const localSessionWithWorkspaces = {
  kind: 'loopback' as const,
  user_ref: null,
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: { id: 'ws-1', name: 'General' },
  workspaces: [
    { id: 'ws-1', name: 'General' },
    { id: 'ws-2', name: 'Fiji TV' },
  ],
};

const localSessionNoWorkspaces = {
  ...localSessionWithWorkspaces,
  active_workspace: undefined,
  workspaces: [],
};

function renderLanding(
  session: unknown,
  workspaces: unknown[] = [],
  projects: unknown[] = [],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.endsWith('/auth/session')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(session) });
      }
      // Workspaces (plandesk REST /orgs/:id/workspaces) vs. projects — answer each by URL.
      if (url.endsWith('/workspaces')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ workspaces }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(projects) });
    }),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Workspace landing (/)', () => {
  it('renders the Plan Desk wordmark, org name, and workspaces with project counts', async () => {
    const workspaces = [
      { id: 'ws-1', name: 'General' },
      { id: 'ws-2', name: 'Fiji TV' },
    ];
    const projects = [
      { id: 'p1', name: 'P1', workspace_id: 'ws-1', description: null, created_at: '', updated_at: '' },
      { id: 'p2', name: 'P2', workspace_id: 'ws-1', description: null, created_at: '', updated_at: '' },
      { id: 'p3', name: 'P3', workspace_id: 'ws-2', description: null, created_at: '', updated_at: '' },
    ];
    renderLanding(localSessionWithWorkspaces, workspaces, projects);

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });

    // Wordmark + org name render.
    expect(await screen.findByRole('heading', { name: 'Plan Desk' })).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();

    // Both workspaces surface; counts come from the project list, tabular.
    // Wait for the workspace cards to mount (the workspaces query resolves async).
    expect(await screen.findByRole('button', { name: /Open workspace General/i })).toBeTruthy();
    expect(screen.getByText('2 projects')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open workspace Fiji TV/i })).toBeTruthy();
    expect(screen.getByText('1 project')).toBeTruthy();
  });

  it('shows an empty state when the org has no workspaces', async () => {
    renderLanding(localSessionNoWorkspaces, [], []);

    expect(await screen.findByText(/no workspaces yet/i)).toBeTruthy();
  });

  it('offers a New workspace affordance to owners only', async () => {
    renderLanding(localSessionWithWorkspaces, [], []);
    expect(await screen.findByRole('button', { name: /new workspace/i })).toBeTruthy();
  });

  it('hides New workspace from non-owners', async () => {
    const member = { ...localSessionWithWorkspaces, role: 'editor' as const };
    renderLanding(member, [], []);
    // Wait for the landing to mount (wordmark renders before the gate check).
    expect(await screen.findByRole('heading', { name: 'Plan Desk' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /new workspace/i })).toBeNull();
  });

  it('selecting a workspace sets it active and navigates to /projects', async () => {
    const workspaces = [
      { id: 'ws-1', name: 'General' },
      { id: 'ws-2', name: 'Fiji TV' },
    ];
    renderLanding(localSessionWithWorkspaces, workspaces, []);

    const fijiButton = await screen.findByRole('button', { name: /Open workspace Fiji TV/i });
    fireEvent.click(fijiButton);

    await waitFor(() => {
      const setActiveCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, init]) =>
            String(url).endsWith('/api/auth/organization/set-active-team') &&
            init?.method === 'POST',
        );
      expect(setActiveCall).toBeTruthy();
      const body = JSON.parse(String(setActiveCall?.[1]?.body)) as { teamId: string };
      expect(body.teamId).toBe('ws-2');
    });
  });
});
