import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from '../../test-utils.js';
import { AccountMenu } from './AccountMenu.js';

const sessionWithWorkspaces = {
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

function renderAccountMenu(path = '/projects/project-a/board') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p>Workspace landing</p>,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$id/board',
    component: AccountMenu,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...rendered, router };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Workspace switcher (REQ-C1)', () => {
  it('renders the active workspace', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/session')) {
        return { ok: true, status: 200, json: () => sessionWithWorkspaces };
      }
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAccountMenu();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeTruthy();
    });
  });

  it('switching calls setActiveWorkspace (POST set-active-team)', async () => {
    const fetchMock = vi.fn((...[input]: [RequestInfo | URL, RequestInit?]) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/session')) {
        return { ok: true, status: 200, json: () => sessionWithWorkspaces };
      }
      if (url.endsWith('/api/auth/organization/set-active-team')) {
        return { ok: true, status: 200, json: () => ({}) };
      }
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { router } = renderAccountMenu();

    // Active workspace is visible immediately.
    await waitFor(() => {
      expect(screen.getByText('General')).toBeTruthy();
    });

    // Open the workspace dropdown via keyboard (robust in jsdom) and pick Fiji TV.
    const trigger = screen.getByRole('button', { name: /switch workspace \(current: general\)/i });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const fijiItem = await screen.findByText('Fiji TV');
    fireEvent.click(fijiItem);

    await waitFor(() => {
      const switchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          requestUrl(url).endsWith('/api/auth/organization/set-active-team') &&
          init?.method === 'POST',
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

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(screen.getByText('Workspace landing')).toBeTruthy();
  });
});
