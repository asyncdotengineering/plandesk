import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxPanel } from './InboxPanel.js';

const projectId = 'proj-1';

const pendingSubmission = {
  id: 'sub-1',
  project_id: projectId,
  hosted_share_id: 'hosted-share-1',
  participant_name: 'Alex',
  title: 'Bug report',
  body: 'Something broke',
  severity: 'high',
  task_ref: null,
  status: 'pending',
  linked_task_id: null,
  created_at: '2026-07-04T12:00:00.000Z',
  pulled_at: '2026-07-04T12:01:00.000Z',
};

const backlogTask = {
  id: 'task-backlog-1',
  project_id: projectId,
  label: 'Investigate flaky export',
  status: 'backlog',
  description: 'Reported via slack',
  x: 0,
  y: 0,
  assignee: null,
  due_date: null,
  created_at: '2026-07-04T12:00:00.000Z',
  updated_at: '2026-07-04T12:00:00.000Z',
};

const proposalTask = {
  id: 'task-scope-1',
  project_id: projectId,
  label: 'Add rate limiting to submissions endpoint',
  status: 'scope',
  description:
    '**Problem** — abuse potential.\n\nProvenance: accept-new — matches REQ-2, no duplicate found.',
  x: 0,
  y: 0,
  assignee: null,
  due_date: null,
  created_at: '2026-07-04T12:00:00.000Z',
  updated_at: '2026-07-04T12:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });
}

function renderInboxPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPanel projectId={projectId} />
    </QueryClientProvider>,
  );
}

function routeFetch(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';

  if (url.includes('/submissions?status=pending') && method === 'GET') {
    return jsonResponse([pendingSubmission]);
  }
  if (url.includes('/tasks?status=backlog') && method === 'GET') {
    return jsonResponse([backlogTask]);
  }
  if (url.includes('/tasks?status=scope') && method === 'GET') {
    return jsonResponse([proposalTask]);
  }
  if (url.match(/\/submissions\/sub-1\/triage$/) && method === 'POST') {
    return jsonResponse({ ...pendingSubmission, status: 'accepted', linked_task_id: 'task-new' });
  }
  if (url.match(/\/tasks\/task-backlog-1$/) && method === 'PATCH') {
    return jsonResponse({ ...backlogTask, status: 'scope' });
  }
  throw new Error(`unexpected fetch: ${method} ${url}`);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InboxPanel', () => {
  it('shows an empty-state message when there are no pending submissions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('/submissions?status=pending')) {
          return jsonResponse([]);
        }
        return routeFetch(url, init);
      }),
    );

    renderInboxPanel();

    await waitFor(() => {
      expect(
        screen.getByText(
          'No pending submissions — this project has no share configured, or nothing new has come in.',
        ),
      ).toBeTruthy();
    });
  });

  it('approve triages a submission as accept, forcing status to scope server-side', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/submissions/sub-1/triage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'accept' }),
        }),
      );
    });
  });

  it('reject triages a submission as reject', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/submissions/sub-1/triage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'reject' }),
        }),
      );
    });
  });

  it('merge-into triages with the typed task id as link_task_id (no interim disclosure)', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });

    // Linking is wired up now — the interim "not wired up" disclosure must be gone.
    expect(screen.queryByText(/wired up yet/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Existing task id'), {
      target: { value: 'task-existing-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Merge into' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/submissions/sub-1/triage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'accept', link_task_id: 'task-existing-1' }),
        }),
      );
    });
  });

  it('shows the submission severity', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch));

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('releases a backlog task to scope', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Investigate flaky export')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Release to scope' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/tasks/task-backlog-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'scope' }),
        }),
      );
    });
  });

  it('refetches the status-scoped lists after a mutation (cache invalidation)', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Investigate flaky export')).toBeTruthy();
    });

    const backlogCalls = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          typeof url === 'string' &&
          url.includes('/tasks?status=backlog') &&
          ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
      ).length;
    const before = backlogCalls();

    fireEvent.click(screen.getByRole('button', { name: 'Release to scope' }));

    // The mutation invalidates the tasks prefix, so the status-scoped backlog list
    // refetches. With the old `…/tasks/all` leaf key it would not — the stale-inbox bug.
    await waitFor(() => {
      expect(backlogCalls()).toBeGreaterThan(before);
    });
  });

  it('shows Curator proposals with their provenance line and acknowledges locally without a network call', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Add rate limiting to submissions endpoint')).toBeTruthy();
    });
    expect(
      screen.getByText('Provenance: accept-new — matches REQ-2, no duplicate found.'),
    ).toBeTruthy();

    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));

    expect(await screen.findByRole('button', { name: 'Acknowledged' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
