import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareButton } from './ShareButton';

const PAGE_URL = 'http://127.0.0.1:3456/p/plandesk_share_abc';
const MARKDOWN_URL = 'http://127.0.0.1:3456/api/v1/share/plandesk_share_abc.md';

describe('ShareButton', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          url: PAGE_URL,
          markdown_url: MARKDOWN_URL,
          expires_at: '2026-07-13T00:00:00.000Z',
        }),
      })),
    );
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mints a share link for a task and copies the human page URL', async () => {
    render(<ShareButton resource={{ kind: 'task', id: 'task-1' }} />);

    fireEvent.click(screen.getByRole('button', { name: /share task/i }));
    fireEvent.click(await screen.findByRole('button', { name: /create link/i }));

    const input = (await screen.findByDisplayValue(PAGE_URL)) as HTMLInputElement;
    expect(input).toBeTruthy();

    // The POST hit the task share endpoint.
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/tasks/task-1/share'));
    expect(call).toBeTruthy();
    expect(call?.[1]?.method).toBe('POST');

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PAGE_URL);
    });
  });
});
