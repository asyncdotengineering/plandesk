import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpTokens } from './McpTokens.js';

const sampleToken = {
  id: 'tok-1',
  name: 'Claude',
  created_at: '2026-06-07T12:00:00.000Z',
  revoked_at: null,
};

const createdToken = {
  ...sampleToken,
  token: 'plandesk_mcp_test_raw_token_value',
};

function renderMcpTokens() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <McpTokens />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('McpTokens', () => {
  it('renders token list from GET /mcp-tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([sampleToken]),
      }),
    );

    renderMcpTokens();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeTruthy();
    });
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows raw token once after create with copy button', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(createdToken),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([createdToken]),
      });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', {
      clipboard: { writeText: writeTextMock },
    });

    renderMcpTokens();

    await waitFor(() => {
      expect(screen.getByText(/no tokens yet/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Token name'), {
      target: { value: 'Claude' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText(createdToken.token)).toBeTruthy();
    });
    expect(screen.getByText(/copy your token now/i)).toBeTruthy();
    expect(screen.getByText(/claude mcp add/i)).toBeTruthy();
    expect(screen.getByText(/codex mcp add/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /copy token/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy();
    });
    expect(writeTextMock).toHaveBeenCalledWith(createdToken.token);
  });

  it('revokes an active token', async () => {
    const revokedToken = { ...sampleToken, revoked_at: '2026-06-07T13:00:00.000Z' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([sampleToken]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([revokedToken]),
      });

    vi.stubGlobal('fetch', fetchMock);

    renderMcpTokens();

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));

    // Revoking is destructive — it now goes through a confirm dialog.
    fireEvent.click(await screen.findByRole('button', { name: /revoke token/i }));

    await waitFor(() => {
      expect(screen.getByText('Revoked')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /^revoke$/i })).toBeNull();
  });
});
