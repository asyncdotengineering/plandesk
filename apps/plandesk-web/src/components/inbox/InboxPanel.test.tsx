import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxPanel } from './InboxPanel.js';

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  return {
    Select: ({ children, value, onValueChange, disabled }: any) =>
      React.createElement('select', {
        value: value ?? '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value),
        disabled,
        'data-testid': 'merge-task-select',
      }, children),
    SelectContent: ({ children }: any) => React.createElement(React.Fragment, {}, children),
    SelectItem: ({ children, value }: any) =>
      React.createElement('option', { value }, children),
    SelectTrigger: ({ children }: any) =>
      React.createElement(React.Fragment, {}, children),
    SelectValue: ({ placeholder }: any) =>
      React.createElement('option', { value: '' }, placeholder),
  };
});

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
  const rootRoute = createRootRoute({
    component: () => <InboxPanel projectId={projectId} />,
  });
  const router = createRouter({ routeTree: rootRoute });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
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
  if (url.includes('/tasks') && method === 'GET' && !url.includes('?status=')) {
    return jsonResponse([backlogTask, proposalTask]);
  }
  if (url.match(/\/submissions\/sub-1\/triage$/) && method === 'POST') {
    return jsonResponse({ ...pendingSubmission, status: 'accepted' });
  }
  if (url.match(/\/submissions\/sub-1\/comments$/) && method === 'GET') {
    return jsonResponse([]);
  }
  if (url.match(/\/submissions\/sub-1\/comments$/) && method === 'POST') {
    if (typeof init?.body !== 'string') {
      throw new Error('expected string request body');
    }
    const parsed = JSON.parse(init.body) as { body: string };
    return jsonResponse({
      id: 'comment-1',
      document_id: null,
      target_type: 'submission',
      target_id: 'sub-1',
      passage: null,
      body: parsed.body,
      resolved: false,
      created_at: '2026-07-04T12:02:00.000Z',
    });
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

  it('reject triages a submission as reject after confirm', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    // Confirm dialog uses the same label on its destructive action.
    await waitFor(() => {
      expect(screen.getByText(/client isn't notified/i)).toBeTruthy();
    });
    const rejectButtons = screen.getAllByRole('button', { name: 'Reject' });
    fireEvent.click(rejectButtons[rejectButtons.length - 1]!);

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

  it('merge-into triages with the selected task id as link_task_id', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });

    // Linking is wired up now — the interim "not wired up" disclosure must be gone.
    expect(screen.queryByText(/wired up yet/)).toBeNull();

    // Wait for the merge task select to appear (tasks query must resolve first).
    await waitFor(() => {
      expect(screen.getByTestId('merge-task-select')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('merge-task-select'), {
      target: { value: 'task-backlog-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Merge into' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/submissions/sub-1/triage',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'accept', link_task_id: 'task-backlog-1' }),
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

  it('shows a collapsible comment thread on a submission row', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Bug report')).toBeTruthy();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/submissions/sub-1/comments?include_resolved=true',
        expect.anything(),
      );
    });

    // Thread collapsed → the comment composer (a rich editor) is not mounted.
    expect(document.querySelector('.document-editor-content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content')).toBeTruthy();
    });
  });

  it('releases a backlog task to scope', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Investigate flaky export')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send to planning' }));

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
          (init?.method ?? 'GET') === 'GET',
      ).length;
    const before = backlogCalls();

    fireEvent.click(screen.getByRole('button', { name: 'Send to planning' }));

    // The mutation invalidates the tasks prefix, so the status-scoped backlog list
    // refetches. With the old `…/tasks/all` leaf key it would not — the stale-inbox bug.
    await waitFor(() => {
      expect(backlogCalls()).toBeGreaterThan(before);
    });
  });

  it('shows Curator proposals with provenance and links to the Board for real approval', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock);

    renderInboxPanel();

    await waitFor(() => {
      expect(screen.getByText('Add rate limiting to submissions endpoint')).toBeTruthy();
    });
    expect(
      screen.getByText('Provenance: accept-new — matches REQ-2, no duplicate found.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Looks good' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /board/i }).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/triage'))).toBe(true);
  });
});
