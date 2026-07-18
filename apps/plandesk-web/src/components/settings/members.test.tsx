import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Members } from './Members.js';

const ownerSession = {
  kind: 'session' as const,
  user_ref: 'user-1',
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
};

const memberSession = {
  kind: 'session' as const,
  user_ref: 'user-2',
  role: 'member' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'member' }],
};

const adminSession = {
  kind: 'session' as const,
  user_ref: 'user-3',
  role: 'admin' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'admin' }],
};

const membersList = {
  members: [
    {
      id: 'mem-1',
      userId: 'user-1',
      email: 'owner@acme.com',
      name: 'Owner',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const createdInvite = {
  invitationId: 'inv-abc',
  claimUrl: 'https://app.example/invite/inv-abc',
};

function renderMembers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Members />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Members invite UI (REQ-2c)', () => {
  it('invite form posts to invitations and renders claim link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ownerSession,
        };
      }
      if (url.includes('/orgs/org-1/members') && (init?.method === undefined || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => membersList,
        };
      }
      if (url.includes('/orgs/org-1/invitations') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => createdInvite,
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not_found' }), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    await waitFor(() => {
      expect(screen.getByText('owner@acme.com')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'teammate@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => {
      expect(screen.getByText(createdInvite.claimUrl)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /copy claim link/i })).toBeTruthy();
    expect(screen.getByText(/link-only/i)).toBeTruthy();

    const inviteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/orgs/org-1/invitations') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(inviteCall).toBeTruthy();
    expect(inviteCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'teammate@acme.com', role: 'member' }),
      }),
    );
  });

  it('member (non-owner) sees the roster but no invite card at all', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => memberSession };
      }
      if (url.includes('/orgs/org-1/members')) {
        return { ok: true, status: 200, json: async () => membersList };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    // Roster is visible to members…
    await waitFor(() => {
      expect(screen.getByText('owner@acme.com')).toBeTruthy();
    });
    // …but the invite affordance is hidden entirely, not shown-disabled.
    expect(screen.queryByText(/invite teammate/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^invite$/i })).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();

    const invitePosts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/invitations') && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(invitePosts).toHaveLength(0);
  });

  it('admin can invite (form present; posts to invitations)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => adminSession };
      }
      if (url.includes('/orgs/org-1/members') && (init?.method === undefined || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => membersList };
      }
      if (url.includes('/orgs/org-1/invitations') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => createdInvite };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not_found' }), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^invite$/i })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'teammate@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => {
      expect(screen.getByText(createdInvite.claimUrl)).toBeTruthy();
    });
  });
});
