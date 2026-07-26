import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceMembers } from './WorkspaceMembers.js';

const ownerSession = {
  kind: 'session' as const,
  user_ref: 'user-1',
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: { id: 'team-1', name: 'Fiji TV' },
  workspaces: [{ id: 'team-1', name: 'Fiji TV' }],
};

const loopbackSession = {
  ...ownerSession,
  kind: 'loopback' as const,
  user_ref: null,
};

const orgMembers = {
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

const teamMembers = [
  { id: 'tm-1', teamId: 'team-1', userId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' },
];

const createdInvite = {
  invitationId: 'inv-abc',
  claimUrl: 'https://app.example/invite/inv-abc',
  teamId: 'team-1',
};

function renderWorkspaceMembers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceMembers />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkspaceMembers invite (workspace-scoped, REQ-5)', () => {
  it('owner invites to the active workspace — posts team_id; renders claim link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => ownerSession };
      }
      if (url.includes('/api/auth/organization/list-team-members')) {
        return { ok: true, status: 200, json: async () => teamMembers };
      }
      if (
        url.includes('/orgs/org-1/members') &&
        (init?.method === undefined || init.method === 'GET')
      ) {
        return { ok: true, status: 200, json: async () => orgMembers };
      }
      if (url.includes('/orgs/org-1/invitations') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => createdInvite };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspaceMembers();

    await waitFor(() => {
      expect(screen.getByText(/invite to workspace/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'teammate@acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => {
      expect(screen.getByText(createdInvite.claimUrl)).toBeTruthy();
    });

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
        body: JSON.stringify({
          email: 'teammate@acme.com',
          role: 'member',
          team_id: 'team-1',
        }),
      }),
    );
  });

  it('does not query or render hosted workspace membership on a local board', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => loopbackSession };
      }
      throw new Error(`unexpected hosted-only request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspaceMembers();

    expect(await screen.findByText(/local workspace access/i)).toBeTruthy();
    expect(screen.getByText(/does not keep member rows/i)).toBeTruthy();
    expect(screen.queryByText(/invite to workspace/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
