import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvitePage } from './InvitePage.js';

const pendingPreview = {
  organizationId: 'org-1',
  organizationName: 'Acme',
  workspaceId: 'team-1',
  workspaceName: 'Fiji TV',
  role: 'admin',
  email: 'dev@acme.com',
  status: 'pending',
  expiresAt: '2026-12-31T00:00:00.000Z',
};

function renderInvite() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InvitePage invitationId="inv-1" />
    </QueryClientProvider>,
  );
}

function stubAssign() {
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
  return assign;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InvitePage (invite claim)', () => {
  it('signed-out invitee sees org + role and a GitHub button (no accept)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'unauthorized' }),
          text: async () => '',
        };
      }
      if (/\/invitations\/inv-1$/.test(url)) {
        return { ok: true, status: 200, json: async () => pendingPreview };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderInvite();

    await waitFor(() => {
      expect(screen.getByText(/you.re invited/i)).toBeTruthy();
    });
    expect(screen.getByText('Fiji TV')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue with github/i })).toBeTruthy();
    expect(screen.getByText(/dev@acme\.com/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /accept invitation/i })).toBeNull();
  });

  it('signed-in invitee accepts → posts to the accept endpoint', async () => {
    stubAssign();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => ({ kind: 'session', user_ref: 'u-1' }) };
      }
      if (
        /\/invitations\/inv-1$/.test(url) &&
        (init?.method === undefined || init.method === 'GET')
      ) {
        return { ok: true, status: 200, json: async () => pendingPreview };
      }
      if (url.includes('/invitations/inv-1/accept') && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            invitationId: 'inv-1',
            organizationId: 'org-1',
            role: 'admin',
            userId: 'u-1',
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderInvite();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /accept invitation/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

    await waitFor(() => {
      const acceptCall = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes('/invitations/inv-1/accept') &&
          (i as RequestInit | undefined)?.method === 'POST',
      );
      expect(acceptCall).toBeTruthy();
    });
  });

  it('already-used invitation shows a notice, no action button', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/session')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'unauthorized' }),
          text: async () => '',
        };
      }
      if (/\/invitations\/inv-1$/.test(url)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...pendingPreview, status: 'accepted' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderInvite();

    await waitFor(() => {
      expect(screen.getByText(/already used/i)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /continue with github/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /accept invitation/i })).toBeNull();
  });
});
