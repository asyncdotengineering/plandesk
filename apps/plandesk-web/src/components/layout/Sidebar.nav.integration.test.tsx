import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routeTree.gen.js';
import { requestUrl } from '../../test-utils.js';

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

const sampleDocument = {
  id: 'doc-1',
  project_id: 'proj-1',
  title: 'Test Doc',
  body: '<p>Hello</p>',
  status_line: null,
  parent_id: null,
  folder_id: null,
  links: [],
  backlinks: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  children: [],
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => '' };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/session')) return ok(session);
      if (url.endsWith('/workspaces')) return ok({ workspaces: session.workspaces });
      if (url.endsWith('/projects') && method === 'GET') return ok([project]);
      if (url.includes('/projects/proj-1') && !url.includes('/documents') && !url.includes('/tasks')) {
        return ok(project);
      }
      if (url.endsWith('/projects/proj-1/documents')) return ok([sampleDocument]);
      if (url.endsWith('/documents/doc-1')) return ok(sampleDocument);
      if (url.endsWith('/documents/doc-1/comments')) return ok([]);
      if (url.endsWith('/folders')) return ok([]);
      if (url.endsWith('/tasks')) return ok([]);
      if (url.endsWith('/tags')) return ok([]);
      return { ok: true, status: 200, json: () => Promise.resolve([]), text: () => '' };
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar documents link (full route tree)', () => {
  it('navigates from document detail to the documents index via the sidebar', async () => {
    stubFetch();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/projects/proj-1/documents/doc-1'],
      }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();

    await waitFor(() => {
      const body = document.body.textContent || '';
      expect(body.includes('Loading document…')).toBe(false);
    });

    const bodyText = document.body.textContent || '';
    if (bodyText.includes('Failed to load')) {
      throw new Error(`Page error: ${bodyText.slice(0, 200)}`);
    }

    await waitFor(() => {
      expect(document.querySelector('a.nav-item[href*="/documents"]')).toBeTruthy();
    });

    const sidebarDocuments = document.querySelector('a.nav-item[href*="/documents"]');
    if (sidebarDocuments === null) {
      throw new Error('Sidebar Documents link not found');
    }
    fireEvent.click(sidebarDocuments);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/projects/proj-1/documents');
    });
  });
});
