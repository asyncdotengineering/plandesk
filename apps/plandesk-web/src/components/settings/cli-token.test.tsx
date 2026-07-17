import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliToken } from './CliToken.js';

const created = {
  token: 'plandesk_owner_cli_token_once_only',
  org_id: 'org-cli-1',
  org_name: 'Acme',
};

function renderCliToken() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CliToken />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CliToken', () => {
  it('shows raw token once after generate with copy button and plandesk login hint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(created),
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', {
      clipboard: { writeText: writeTextMock },
    });

    renderCliToken();

    fireEvent.click(screen.getByRole('button', { name: /generate cli token/i }));

    await waitFor(() => {
      expect(screen.getByText(created.token)).toBeTruthy();
    });
    expect(screen.getByText(/copy your token now/i)).toBeTruthy();
    expect(screen.getByText(/you won't see this again/i)).toBeTruthy();
    expect(screen.getAllByText(/plandesk login/i).length).toBeGreaterThan(0);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/cli-token',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    fireEvent.click(screen.getByRole('button', { name: /copy token/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy();
    });
    expect(writeTextMock).toHaveBeenCalledWith(created.token);
  });
});
