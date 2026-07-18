import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalPage } from './components/portal/PortalPage.js';
import { capabilitiesFromShare } from './lib/capabilities.js';
import type { ClientView } from './lib/portal.js';
import {
  PortalNotReadyError,
  PortalRateLimitedError,
  PortalSubmitForbiddenError,
  PortalUnauthorizedError,
  clearPortalSession,
  fetchClientView,
  fetchShareMeta,
  joinShare,
  listMySubmissions,
  loadPortalSession,
  savePortalSession,
  submitIssue,
} from './lib/portal.js';
import { routeTree } from './routeTree.gen.js';

vi.mock('./lib/portal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/portal.js')>();
  return {
    ...actual,
    joinShare: vi.fn(),
    fetchShareMeta: vi.fn(),
    fetchClientView: vi.fn(),
    submitIssue: vi.fn(),
    listMySubmissions: vi.fn(),
    loadPortalSession: vi.fn(),
    savePortalSession: vi.fn(),
    clearPortalSession: vi.fn(),
  };
});

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

const submitEnabledView: ClientView = {
  ...sampleView,
  share: {
    ...sampleView.share,
    permissions: { read: true, submit: true },
  },
};

function renderPortalPage(view: ClientView, onUnauthorized = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PortalPage
        view={view}
        shareToken="test-token"
        sessionToken="session-abc"
        onUnauthorized={onUnauthorized}
      />
    </QueryClientProvider>,
  );
}

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close(): void {}
}

function renderPortalRoute() {
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
  vi.mocked(loadPortalSession).mockReturnValue(null);
  vi.mocked(joinShare).mockReset();
  vi.mocked(fetchShareMeta).mockResolvedValue({
    audience_name: 'Acme Corp',
    mode: 'public',
  });
  vi.mocked(fetchClientView).mockReset();
  vi.mocked(submitIssue).mockReset();
  vi.mocked(listMySubmissions).mockResolvedValue([]);
  vi.mocked(savePortalSession).mockReset();
  vi.mocked(clearPortalSession).mockReset();
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
    renderPortalPage(sampleView);

    expect(screen.getByRole('heading', { name: 'Portal Project' })).toBeTruthy();
    expect(screen.getByText('Ship portal')).toBeTruthy();
    expect(screen.getByLabelText('Progress').textContent).toContain('in progress');
    expect(screen.getByLabelText('Progress').textContent).toContain('todo');
    expect(screen.getByText('Shared scope details')).toBeTruthy();
    expect(screen.getByText('Ship portal must finish before Write tests')).toBeTruthy();
    expect(screen.getByText('shared, read-only')).toBeTruthy();
    expect(screen.getByText('Shared with Acme Corp')).toBeTruthy();

    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByText('+ Add task')).toBeNull();
    expect(screen.queryByLabelText('Report an issue')).toBeNull();
    expect(screen.queryByLabelText('Your reported issues')).toBeNull();
  });

  it('hides submit UI when the share does not grant submit', () => {
    renderPortalPage(sampleView);

    expect(screen.queryByRole('button', { name: 'Report an issue' })).toBeNull();
    expect(listMySubmissions).not.toHaveBeenCalled();
  });

  it('shows submit UI when the share grants submit', async () => {
    renderPortalPage(submitEnabledView);

    expect(screen.getByLabelText('Report an issue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeTruthy();

    await waitFor(() => {
      expect(listMySubmissions).toHaveBeenCalledWith('test-token', 'session-abc');
    });

    expect(screen.getByLabelText('Your reported issues')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("You haven't reported anything yet.")).toBeTruthy();
    });
  });

  it('submits an issue and lists it after success', async () => {
    const createdSubmission = {
      id: 'sub-1',
      title: 'Broken export',
      severity: 'high',
      status: 'pending',
      created_at: '2026-06-09T12:00:00.000Z',
    };
    vi.mocked(submitIssue).mockResolvedValue(createdSubmission);
    vi.mocked(listMySubmissions).mockResolvedValueOnce([]).mockResolvedValue([createdSubmission]);

    renderPortalPage(submitEnabledView);

    await waitFor(() => {
      expect(screen.getByText("You haven't reported anything yet.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Broken export' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Export fails on Safari' },
    });
    fireEvent.change(screen.getByLabelText(/Severity/), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(submitIssue).toHaveBeenCalledWith('test-token', 'session-abc', {
        title: 'Broken export',
        body: 'Export fails on Safari',
        severity: 'high',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Reported ✓')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText('Broken export')).toBeTruthy();
    });

    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('shows rate-limit messaging on 429', async () => {
    vi.mocked(submitIssue).mockRejectedValue(new PortalRateLimitedError());

    renderPortalPage(submitEnabledView);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Report an issue' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Too many' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(
        screen.getByText("You're sending these too fast — try again in a moment."),
      ).toBeTruthy();
    });
  });

  it('shows a permission message on forbidden response', async () => {
    vi.mocked(submitIssue).mockRejectedValue(new PortalSubmitForbiddenError());

    renderPortalPage(submitEnabledView);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Report an issue' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Blocked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(
        screen.getByText("You don't have permission to submit to this share."),
      ).toBeTruthy();
    });
  });
});

describe('Portal route', () => {
  it('renders the join gate when no session is stored', async () => {
    renderPortalRoute();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeTruthy();
    });

    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(fetchClientView).not.toHaveBeenCalled();
  });

  // An external participant holds a share token, not an org membership: org
  // sign-in must never stand between them and the share link.
  it('is never gated behind org sign-in', async () => {
    renderPortalRoute();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeTruthy();
    });

    expect(screen.queryByText('Welcome to Plan Desk')).toBeNull();
    expect(screen.queryByRole('link', { name: /continue with github/i })).toBeNull();
  });

  it('does not call joinShare when name is empty', async () => {
    renderPortalRoute();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    });

    const joinButton = screen.getByRole('button', { name: 'Join' });
    expect(joinButton).toHaveProperty('disabled', true);

    fireEvent.click(joinButton);
    expect(joinShare).not.toHaveBeenCalled();
  });

  it('loads the read-only view after a successful join', async () => {
    vi.mocked(joinShare).mockResolvedValue({
      session_token: 'session-abc',
      participant: { id: 'p1', name: 'Alex' },
      share: { audience_name: 'Acme Corp', permissions: { read: true, submit: false } },
    });
    vi.mocked(fetchClientView).mockResolvedValue(sampleView);

    renderPortalRoute();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).not.toHaveProperty('disabled', true);
    });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      expect(joinShare).toHaveBeenCalledWith('test-token', { name: 'Alex' });
    });

    await waitFor(() => {
      expect(savePortalSession).toHaveBeenCalledWith('test-token', 'session-abc');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Portal Project' })).toBeTruthy();
    });

    expect(fetchClientView).toHaveBeenCalledWith('test-token', 'session-abc');
    expect(screen.getByText('Ship portal')).toBeTruthy();
    expect(screen.getByText('Shared scope details')).toBeTruthy();
  });

  it('clears the session and shows the join gate when the view returns unauthorized', async () => {
    vi.mocked(loadPortalSession).mockReturnValue('stale-session');
    vi.mocked(fetchClientView).mockRejectedValue(new PortalUnauthorizedError());

    renderPortalRoute();

    await waitFor(() => {
      expect(clearPortalSession).toHaveBeenCalledWith('test-token');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeTruthy();
    });
  });

  it('renders not-ready state when projection is missing', async () => {
    vi.mocked(loadPortalSession).mockReturnValue('session-abc');
    vi.mocked(fetchClientView).mockRejectedValue(new PortalNotReadyError());

    renderPortalRoute();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Not published yet' })).toBeTruthy();
    });

    expect(screen.getByText('This project has not been published to the portal yet.')).toBeTruthy();
  });
});
