import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.gen.js';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const browserSession = {
  kind: 'session' as const,
  user_ref: 'github:1',
  role: 'editor' as const,
  org: { id: 'org-2', name: 'Acme' },
  orgs: [{ id: 'org-2', name: 'Acme', role: 'member' }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectBoardPage', () => {
  it('shows a friendly error with a Retry button when tasks fail to load', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/session')) {
        return jsonResponse(browserSession);
      }
      if (url.includes('/projects/proj-1') && !url.includes('/tasks') && !url.includes('/tags')) {
        return jsonResponse({
          id: 'proj-1',
          name: 'Test Project',
          description: null,
          summary: { scope: 0, todo: 0, in_progress: 0, done: 0, backlog: 0 },
          created_at: '2026-06-07T00:00:00.000Z',
          updated_at: '2026-06-07T00:00:00.000Z',
        });
      }
      if (url.includes('/tasks')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server error' }),
          text: () => Promise.resolve('Server error'),
        });
      }
      if (url.includes('/tags')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/projects/proj-1/board'],
      }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load this board/i)).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // After retry, the tasks query should refetch.
    await waitFor(() => {
      const taskCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/tasks'),
      );
      expect(taskCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
