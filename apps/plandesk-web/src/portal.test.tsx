import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalPage } from './components/portal/PortalPage.js';
import { capabilitiesFromShare } from './lib/capabilities.js';
import type { ClientView } from './lib/portal.js';
import { routeTree } from './routeTree.gen.js';

const sampleView: ClientView = {
  project: {
    id: 'proj-1',
    name: 'Portal Project',
    description: 'A shared plan',
    updated_at: '2026-06-07T00:00:00.000Z',
  },
  tasks: [
    {
      id: 't1',
      label: 'Ship portal',
      status: 'in_progress',
      due_date: '2026-06-15T00:00:00.000Z',
      x: 0,
      y: 0,
      assignee: 'Alex',
      description: 'Read-only guest view',
    },
    {
      id: 't2',
      label: 'Write tests',
      status: 'todo',
      due_date: null,
      x: 0,
      y: 0,
    },
  ],
  edges: [{ id: 'e1', from: 't2', to: 't1', label: 'depends_on' }],
  documents: [
    {
      id: 'd1',
      title: 'Scope',
      body_html: '<p>Shared scope details</p>',
      updated_at: '2026-06-07T00:00:00.000Z',
    },
  ],
  progress: { in_progress: 1, todo: 1 },
  share: {
    audience_name: 'Acme Corp',
    permissions: { read: true, submit: false },
    expires_at: null,
  },
};

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close(): void {}
}

function renderPortalRoute(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ['/p/test-token'],
    }),
  });

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
  cleanup();
  vi.unstubAllGlobals();
});

describe('capabilitiesFromShare', () => {
  it('maps read and submit permissions to capabilities', () => {
    expect(capabilitiesFromShare({ read: true, submit: false })).toEqual(['read']);
    expect(capabilitiesFromShare({ read: true, submit: true })).toEqual(['read', 'submit']);
    expect(capabilitiesFromShare({ read: false, submit: true })).toEqual(['submit']);
    expect(capabilitiesFromShare({ read: false, submit: false })).toEqual([]);
  });
});

describe('PortalPage', () => {
  it('renders project, task, progress, and document content without write controls', () => {
    render(<PortalPage view={sampleView} />);

    expect(screen.getByRole('heading', { name: 'Portal Project' })).toBeTruthy();
    expect(screen.getByText('Ship portal')).toBeTruthy();
    expect(screen.getByLabelText('Progress').textContent).toContain('in progress');
    expect(screen.getByLabelText('Progress').textContent).toContain('todo');
    expect(screen.getByText('Shared scope details')).toBeTruthy();
    expect(screen.getByText('Write tests → Ship portal (depends_on)')).toBeTruthy();
    expect(screen.getByText('shared, read-only')).toBeTruthy();
    expect(screen.getByText('Shared with Acme Corp')).toBeTruthy();

    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByText('+ Add task')).toBeNull();
  });
});

describe('Portal route', () => {
  it('renders unauthorized state for revoked or invalid share links', async () => {
    renderPortalRoute(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Link unavailable' })).toBeTruthy();
    });

    expect(
      screen.getByText('This share link is invalid, expired, or has been revoked.'),
    ).toBeTruthy();
  });

  it('renders not-ready state when projection is missing', async () => {
    renderPortalRoute(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('not_found'),
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Not published yet' })).toBeTruthy();
    });

    expect(screen.getByText('This project has not been published to the portal yet.')).toBeTruthy();
  });

  it('hydrates from GET /api/portal/v1/shares/:token/view', async () => {
    renderPortalRoute(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleView),
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Portal Project' })).toBeTruthy();
    });

    expect(screen.getByText('Ship portal')).toBeTruthy();
    expect(screen.getByText('Shared scope details')).toBeTruthy();

    const [calledUrl] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(calledUrl).toBe('/api/portal/v1/shares/test-token/view');
  });
});
