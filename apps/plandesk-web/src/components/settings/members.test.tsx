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

  it('member (non-owner) cannot invite', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => memberSession,
        };
      }
      if (url.includes('/orgs/org-1/members')) {
        return {
          ok: true,
          status: 200,
          json: async () => membersList,
        };
      }
      if (url.includes('/orgs/org-1/invitations') && init?.method === 'POST') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'forbidden' }),
          text: async () => JSON.stringify({ error: 'forbidden' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    await waitFor(() => {
      expect(screen.getByText(/only organization owners can invite/i)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /^invite$/i })).toBeNull();

    const invitePosts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/invitations') && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(invitePosts).toHaveLength(0);
  });
});
