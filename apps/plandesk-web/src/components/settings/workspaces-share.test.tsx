import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from '../../test-utils.js';
import { Workspaces } from './Workspaces.js';

const ownerSession = {
  kind: 'session' as const,
  user_ref: 'user-1',
  role: 'owner' as const,
  org: { id: 'org-1', name: 'Acme' },
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
  active_workspace: { id: 'team-1', name: 'Fiji TV' },
  workspaces: [
    { id: 'team-1', name: 'Fiji TV' },
    { id: 'team-2', name: 'Kuralle' },
  ],
};

function renderWorkspaces() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Workspaces />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Workspaces — share with client (REQ-6)', () => {
  it('owner-only Share control creates a workspace share link', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes('/auth/session')) {
        return { ok: true, status: 200, json: () => ownerSession };
      }
      if (url.endsWith('/workspaces')) {
        return { ok: true, status: 200, json: () => ({ workspaces: ownerSession.workspaces }) };
      }
      if (url.includes('/api/v1/workspaces/team-1/share') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: () => ({
            url: 'http://localhost/p/plandesk_share_ws1',
            token: 'plandesk_share_ws1',
          }),
        };
      }
      return { ok: false, status: 404, json: () => ({}), text: () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspaces();

    // Workspaces list renders.
    await waitFor(() => {
      expect(screen.getByText('Fiji TV')).toBeTruthy();
    });

    // An owner-gated Share button is present per workspace.
    const shareTrigger = screen.getByLabelText(/Share Fiji TV with a client/i);
    expect(shareTrigger).toBeTruthy();

    fireEvent.click(shareTrigger);

    const audienceInput = await screen.findByLabelText('Audience name');
    fireEvent.change(audienceInput, { target: { value: 'Acme Client' } });
    fireEvent.click(screen.getByRole('button', { name: /create link/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('http://localhost/p/plandesk_share_ws1')).toBeTruthy();
    });

    const shareCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        requestUrl(url).includes('/api/v1/workspaces/team-1/share') && init?.method === 'POST',
    );
    expect(shareCall).toBeTruthy();
    expect(shareCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ audience_name: 'Acme Client', mode: 'public', submit: false }),
      }),
    );
  });
});
