import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerializedComment } from '../../lib/api.js';
import { CommentsPanel } from './CommentsPanel.js';

const openComment: SerializedComment = {
  id: 'cmt-1',
  document_id: 'doc-1',
  passage: '§1 intro',
  body: 'Revise intro',
  resolved: false,
  created_at: '2026-06-07T12:00:00.000Z',
};

const resolvedComment: SerializedComment = {
  id: 'cmt-2',
  document_id: 'doc-1',
  passage: null,
  body: 'Done',
  resolved: true,
  created_at: '2026-06-07T13:00:00.000Z',
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommentsPanel target={{ type: 'document', id: 'doc-1' }} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CommentsPanel', () => {
  it('lists open comments and hides resolved until toggled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([openComment, resolvedComment]),
      }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Revise intro')).toBeTruthy();
    });
    expect(screen.getByText('1 open')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /show resolved/i }));
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('creates a comment with attached passage', async () => {
    const created: SerializedComment = {
      id: 'cmt-3',
      document_id: 'doc-1',
      passage: 'selected text',
      body: 'New feedback',
      resolved: false,
      created_at: '2026-06-07T14:00:00.000Z',
    };

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
        json: () => Promise.resolve(created),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([created]),
      });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('getSelection', vi.fn().mockReturnValue({ toString: () => 'selected text' }));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/leave feedback/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /attach selection/i }));
    expect(screen.getByText(/selected text/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/leave feedback/i), {
      target: { value: 'New feedback' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/documents/doc-1/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'New feedback', passage: 'selected text' }),
        }),
      );
    });
  });

  it('pre-attaches a passage handed in from a document highlight (no Attach-selection click)', async () => {
    const onPassageConsumed = vi.fn();
    const created: SerializedComment = {
      id: 'cmt-4',
      document_id: 'doc-1',
      passage: 'Phase C in scope',
      body: 'anchor comment',
      resolved: false,
      created_at: '2026-06-07T15:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve(created) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([created]) });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <CommentsPanel
          target={{ type: 'document', id: 'doc-1' }}
          attachPassage="Phase C in scope"
          onPassageConsumed={onPassageConsumed}
        />
      </QueryClientProvider>,
    );

    // The passage from the highlight is pre-attached — no "Attach selection" click.
    await waitFor(() => {
      expect(screen.getByText(/Phase C in scope/)).toBeTruthy();
    });
    expect(onPassageConsumed).toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/leave feedback/i), {
      target: { value: 'anchor comment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/documents/doc-1/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'anchor comment', passage: 'Phase C in scope' }),
        }),
      );
    });
  });

  it('resolves and deletes a comment', async () => {
    const resolved = { ...openComment, resolved: true };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([openComment]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(resolved),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([resolved]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Revise intro')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/comments/cmt-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /show resolved/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/comments/cmt-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('shows empty state when no comments exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/no comments yet/i)).toBeTruthy();
    });
  });
});
