import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import { listProjects } from '../../lib/api.js';

const sessionOwner = {
  kind: 'session' as const,
  user_ref: 'github:9001',
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: { id: 'ws-1', name: 'General' },
  workspaces: [
    { id: 'ws-1', name: 'General' },
    { id: 'ws-2', name: 'Fiji TV' },
  ],
};

const sessionMember = {
  ...sessionOwner,
  role: 'commenter' as const,
  orgs: [{ id: 'org-1', name: 'Acme', role: 'commenter' }],
};

const workspacesDefault = sessionOwner.workspaces;

/** Mounts a projects query so workspace-switch invalidation is observable. */
function ProjectsProbe() {
  useQuery({ queryKey: ['projects'], queryFn: listProjects });
  return null;
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' };
}

function stubFetch(opts: {
  session?: typeof sessionOwner;
  workspaces?: typeof workspacesDefault;
  created?: { id: string; name: string };
} = {}) {
  const session = opts.session ?? sessionOwner;
  const workspaces = opts.workspaces ?? workspacesDefault;
  const created = opts.created ?? { id: 'ws-new', name: 'Fresh' };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/auth/session')) return ok(session);
    if (url.endsWith('/workspaces') && method === 'GET') return ok({ workspaces });
    if (url.endsWith('/workspaces') && method === 'POST') return ok(created);
    if (url.endsWith('/set-active-team')) return ok({});
    if (url.endsWith('/projects')) return ok([]);
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSwitcher() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectsProbe />
      <WorkspaceSwitcher />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar workspace switcher (REQ-1 / REQ-2)', () => {
  it('renders the active workspace', async () => {
    stubFetch();

    renderSwitcher();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeTruthy();
    });
  });

  it('switching calls set-active-team and invalidates the projects query', async () => {
    const fetchMock = stubFetch();

    renderSwitcher();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeTruthy();
    });
    // Projects probe mounts once on first render.
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/projects')).length).toBe(1);
    });

    // Open the dropdown via keyboard (robust in jsdom) and pick Fiji TV.
    const trigger = screen.getByRole('button', { name: /switch workspace \(current: general\)/i });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const fiji = await screen.findByText('Fiji TV');
    fireEvent.click(fiji);

    // The switch fired.
    await waitFor(() => {
      const switchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/set-active-team') && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(switchCall).toBeTruthy();
      expect(switchCall?.[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ teamId: 'ws-2' }),
        }),
      );
    });

    // set-active-team's onSuccess invalidates every query → projects refetch.
    await waitFor(() => {
      const projectCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/projects')).length;
      expect(projectCalls).toBeGreaterThanOrEqual(2);
    });
  });

  it('inline "+ New workspace" creates the workspace and switches to it', async () => {
    const fetchMock = stubFetch({ created: { id: 'ws-new', name: 'Fresh' } });

    renderSwitcher();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /new workspace/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

    // POST /orgs/:id/workspaces then set-active-team (to the new workspace).
    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/workspaces') && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(createCall).toBeTruthy();
      expect(createCall?.[1]).toEqual(
        expect.objectContaining({ body: JSON.stringify({ name: 'Fresh' }) }),
      );
    });
    await waitFor(() => {
      const switchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/set-active-team') &&
          (init as RequestInit | undefined)?.method === 'POST' &&
          (init as RequestInit | undefined)?.body === JSON.stringify({ teamId: 'ws-new' }),
      );
      expect(switchCall).toBeTruthy();
    });
  });

  it('hides the create affordance for non-owners', async () => {
    stubFetch({ session: sessionMember });

    renderSwitcher();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeTruthy();
    });

    // Switcher is still available (2 workspaces)…
    expect(screen.getByRole('button', { name: /switch workspace/i })).toBeTruthy();
    // …but no create affordance.
    expect(screen.queryByRole('button', { name: /new workspace/i })).toBeNull();
  });
});
