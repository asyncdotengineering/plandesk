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

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close(): void {}
}

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

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Project list', () => {
  it('renders projects from GET /projects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([sampleProject]),
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^projects$/i })).toBeTruthy();
    });

    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
    expect(screen.getByText('First project')).toBeTruthy();
  });

  it('shows empty state when no projects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeTruthy();
    });
  });
});
