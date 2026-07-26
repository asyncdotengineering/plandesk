import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from '../../test-utils.js';
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

const loopbackSession = {
  ...ownerSession,
  kind: 'loopback' as const,
  user_ref: null,
  org: { id: '00000000-0000-4000-8000-000000000000', name: 'Personal' },
  orgs: [
    {
      id: '00000000-0000-4000-8000-000000000000',
      name: 'Personal',
      role: 'owner',
    },
  ],
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
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: () => ownerSession };
      }
      if (url.includes('/orgs/org-1/members')) {
        return { ok: true, status: 200, json: () => membersList };
      }
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
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
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: () => memberSession };
      }
      if (url.includes('/orgs/org-1/members')) {
        return { ok: true, status: 200, json: () => membersList };
      }
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    await waitFor(() => {
      expect(screen.getByText('owner@acme.com')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /^invite$/i })).toBeNull();
  });

  it('explains local owner access without querying hosted member rows', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: () => loopbackSession };
      }
      throw new Error(`unexpected hosted-only request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    expect(await screen.findByText(/local board access/i)).toBeTruthy();
    expect(screen.getByText(/loopback is trusted as owner/i)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => requestUrl(url).includes('/members'))).toBe(false);
  });

  it('shows a failed members request with a retry that refetches', async () => {
    let memberRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: () => ownerSession };
      }
      if (url.includes('/orgs/org-1/members')) {
        memberRequests += 1;
        if (memberRequests === 1) {
          return {
            ok: false,
            status: 503,
            json: () => ({ error: 'unavailable' }),
            text: () => 'unavailable',
          };
        }
        return { ok: true, status: 200, json: () => membersList };
      }
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderMembers();

    expect((await screen.findByRole('alert')).textContent).toMatch(/failed to load members/i);
    expect(screen.queryByText(/loading members/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('owner@acme.com')).toBeTruthy();
    expect(memberRequests).toBe(2);
  });
});
