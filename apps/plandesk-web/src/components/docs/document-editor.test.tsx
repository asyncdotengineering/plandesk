import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatchDocumentInput, SerializedDocument } from '../../lib/api.js';
import { DocumentEditor } from './DocumentEditor.js';

const sampleDocument: SerializedDocument = {
  id: 'doc-1',
  project_id: 'proj-1',
  title: 'Spec',
  body: '<p>Initial content</p>',
  status_line: 'Status: draft',
  parent_id: null,
  folder_id: null,
  links: [
    {
      type: 'task',
      id: 'task-1',
      title: 'Implement',
      label: 'documents',
      edge_id: 'edge-1',
    },
  ],
  backlinks: [],
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // Radix Dialog in jsdom.
  const el = window.Element.prototype as unknown as Record<string, unknown>;
  el.hasPointerCapture ??= vi.fn(() => false);
  el.setPointerCapture ??= vi.fn();
  el.releasePointerCapture ??= vi.fn();
  el.scrollIntoView ??= vi.fn();
});

describe('DocumentEditor', () => {
  it('auto-saves title, HTML body, and status_line — flushed on navigation away', async () => {
    const onSave = vi.fn();

    const { unmount } = render(
      <DocumentEditor document={sampleDocument} mode="editor" onSave={onSave} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Document title')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Updated title' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'Status: in review' },
    });

    // Navigating away (unmount) flushes any pending edit immediately.
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0]?.[0] as PatchDocumentInput | undefined;
    expect(payload?.title).toBe('Updated title');
    expect(payload?.status_line).toBe('Status: in review');
    expect(typeof payload?.body).toBe('string');
    expect(payload?.body).toContain('Initial content');
  });

  it('renders delete button and calls onDelete after confirm dialog', async () => {
    const onDelete = vi.fn();

    render(
      <DocumentEditor
        document={sampleDocument}
        mode="editor"
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete document' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('inserts an uploaded image as a base64 img node in the saved body', async () => {
    const onSave = vi.fn();

    const { unmount } = render(
      <DocumentEditor document={sampleDocument} mode="editor" onSave={onSave} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Insert image')).toBeTruthy();
    });

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'diagram.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('Insert image'), { target: { files: [file] } });

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content img')).toBeTruthy();
    });

    // The image edit marks the doc dirty; navigating away flushes it.
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0]?.[0] as PatchDocumentInput | undefined;
    expect(payload?.body).toContain('data:image/png;base64,');
    expect(payload?.body).toContain('alt="diagram.png"');
  });

  it('keeps base64 images in sanitized reader content', () => {
    const withImage: SerializedDocument = {
      ...sampleDocument,
      body: '<p>Doc</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="diagram">',
    };

    render(<DocumentEditor document={withImage} mode="reader" onSave={vi.fn()} />);

    const img = document.querySelector('.document-reader-content img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('renders sanitized reader content without executing scripts', () => {
    const malicious: SerializedDocument = {
      ...sampleDocument,
      body: '<p>Safe</p><script>alert("xss")</script>',
    };

    render(<DocumentEditor document={malicious} mode="reader" onSave={vi.fn()} />);

    expect(screen.getByText('Safe')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('renders legacy markdown bodies as rich text in reader mode', () => {
    const markdownDoc: SerializedDocument = {
      ...sampleDocument,
      body: '## Hosts\n\n- one\n- two\n\nA paragraph.',
    };

    render(<DocumentEditor document={markdownDoc} mode="reader" onSave={vi.fn()} />);

    const reader = document.querySelector('.document-reader-content');
    expect(reader?.querySelector('h2')?.textContent).toBe('Hosts');
    expect(reader?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders resolved wiki-links in legacy markdown bodies', () => {
    const markdownDoc: SerializedDocument = {
      ...sampleDocument,
      body: 'See [[Spec|the spec]] and [[Missing]].',
    };

    render(
      <DocumentEditor
        document={markdownDoc}
        mode="reader"
        onSave={vi.fn()}
        docLinks={[{ id: 'doc-1', title: 'Spec' }]}
      />,
    );

    const reader = document.querySelector('.document-reader-content');
    expect(reader?.querySelector('a[href="/documents/doc-1"]')?.textContent).toBe('the spec');
    expect(reader?.querySelector('.wikilink-unresolved')?.textContent).toBe('Missing');
    expect(reader?.textContent).not.toContain('[[');
  });

  it('surfaces a floating Add-comment button on selection and hands up the passage', async () => {
    const onCommentOnSelection = vi.fn();
    vi.stubGlobal(
      'getSelection',
      vi.fn().mockReturnValue({
        toString: () => 'Phase C in scope',
        rangeCount: 1,
        anchorNode: null,
        removeAllRanges: vi.fn(),
        getRangeAt: () => ({
          getBoundingClientRect: () => ({ top: 120, left: 40, width: 80 }),
        }),
      }),
    );

    render(
      <DocumentEditor
        document={sampleDocument}
        mode="reader"
        onSave={vi.fn()}
        onCommentOnSelection={onCommentOnSelection}
      />,
    );

    const reader = document.querySelector('.document-reader-content');
    expect(reader).toBeTruthy();
    fireEvent.mouseUp(reader as Element);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add comment/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));
    expect(onCommentOnSelection).toHaveBeenCalledWith('Phase C in scope');
  });

  it('shows no Add-comment affordance when onCommentOnSelection is not provided', () => {
    render(<DocumentEditor document={sampleDocument} mode="reader" onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /add comment/i })).toBeNull();
  });
});
