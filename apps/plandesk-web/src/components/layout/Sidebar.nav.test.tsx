import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Minimal reproduction of Sidebar NavRow: Link to the documents index with
 * default activeOptions (prefix match). From a document detail URL, clicking
 * "Documents" must navigate back to the index — the reported defect.
 */
function DocumentsNavLink({ id }: { id: string }) {
  return (
    <Link
      to="/projects/$id/documents"
      params={{ id }}
      className="nav-item"
      activeProps={{ className: 'active' }}
    >
      Documents
    </Link>
  );
}

function renderDocumentsNav(initialPath: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$id/documents/',
    component: () => (
      <div>
        <DocumentsNavLink id="proj-1" />
        <p>Documents index</p>
      </div>
    ),
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$id/documents/$docId',
    component: () => (
      <div>
        <DocumentsNavLink id="proj-1" />
        <p>Document detail</p>
      </div>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

afterEach(() => {
  cleanup();
});

describe('Sidebar documents link (NavRow contract)', () => {
  it('navigates from document detail to the documents index', async () => {
    const { router } = renderDocumentsNav('/projects/proj-1/documents/doc-1');
    await router.load();

    expect(screen.getByText('Document detail')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects/proj-1/documents/doc-1');

    fireEvent.click(screen.getByRole('link', { name: 'Documents' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/projects/proj-1/documents');
    });
    expect(screen.getByText('Documents index')).toBeTruthy();
  });

  it('marks the link active on the detail route (prefix match) without blocking navigation', async () => {
    const { router } = renderDocumentsNav('/projects/proj-1/documents/doc-1');
    await router.load();

    const link = screen.getByRole('link', { name: 'Documents' });
    expect(link.className).toContain('active');
  });
});
