import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Members } from './Members.js';

const ownerSession = {
  kind: 'session' as const,
  user_ref: 'user-1',
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: null,
  workspaces: [],
};

const memberSession = {
  kind: 'session' as const,
  user_ref: 'user-2',
  role: 'member' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'member' }],
  active_workspace: null,
  workspaces: [],
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

describe('Members (read-only org roster; invites moved to Workspaces)', () => {
  it('owner sees the org roster but no invite affordance (REQ-6)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => ownerSession };
      }
      if (url.includes('/orgs/org-1/members')) {
        return { ok: true, status: 200, json: async () => membersList };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    await waitFor(() => {
      expect(screen.getByText('owner@acme.com')).toBeTruthy();
    });

    // Invites are workspace-scoped now — the org roster has no invite UI.
    expect(screen.queryByText(/invite teammate/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^invite$/i })).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByText(/invite to a specific workspace/i)).toBeTruthy();
  });

  it('member sees the org roster with no invite affordance', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('owner@acme.com')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /^invite$/i })).toBeNull();
  });
});
