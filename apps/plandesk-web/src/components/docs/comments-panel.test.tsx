import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedComment } from '../../lib/api.js';
import { CommentsPanel, commentHasContent } from './CommentsPanel.js';

// The composer is now a rich (contenteditable) editor. Typing into TipTap isn't
// reproducible under jsdom (no user-event; ProseMirror paste needs getClientRects),
// so these tests cover the reliable wiring — render, passage attach, and the
// empty-gating — while the empty/content logic is unit-tested via commentHasContent
// and the full type→post flow is verified live in a browser.

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

beforeEach(() => {
  // Radix Dialog (delete confirm) in jsdom.
  const el = window.Element.prototype as unknown as Record<string, unknown>;
  el.hasPointerCapture ??= vi.fn(() => false);
  el.setPointerCapture ??= vi.fn();
  el.releasePointerCapture ??= vi.fn();
  el.scrollIntoView ??= vi.fn();
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

  it('attaches a selected passage and keeps Comment disabled until there is content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) }),
    );
    vi.stubGlobal('getSelection', vi.fn().mockReturnValue({ toString: () => 'selected text' }));

    renderPanel();

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content')).toBeTruthy();
    });

    // Empty composer → the Comment button is disabled.
    expect(screen.getByRole('button', { name: 'Comment' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /attach selection/i }));
    expect(screen.getByText(/selected text/)).toBeTruthy();
  });

  it('pre-attaches a passage handed in from a document highlight (no Attach-selection click)', async () => {
    const onPassageConsumed = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) }),
    );

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
      expect(screen.getByRole('button', { name: 'Delete comment' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
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

describe('commentHasContent', () => {
  it('is false for empty or whitespace-only HTML', () => {
    expect(commentHasContent('')).toBe(false);
    expect(commentHasContent('<p></p>')).toBe(false);
    expect(commentHasContent('<p>   </p>')).toBe(false);
    expect(commentHasContent('<p>&nbsp;</p>')).toBe(false);
  });

  it('is true when there is text', () => {
    expect(commentHasContent('<p>Looks good</p>')).toBe(true);
  });

  it('is true when there is an image but no text (annotated screenshot)', () => {
    expect(commentHasContent('<p></p><img src="data:image/png;base64,AAAA">')).toBe(true);
  });
});
