import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PatchDocumentInput, SerializedDocument } from '../../lib/api.js';
import { DocumentEditor } from './DocumentEditor.js';

const sampleDocument: SerializedDocument = {
  id: 'doc-1',
  project_id: 'proj-1',
  title: 'Spec',
  body: '<p>Initial content</p>',
  status_line: 'Status: draft',
  parent_id: null,
  linked_task_id: 'task-1',
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentEditor', () => {
  it('calls onSave with title, HTML body, and status_line via PATCH payload', async () => {
    const onSave = vi.fn();

    render(<DocumentEditor document={sampleDocument} mode="editor" onSave={onSave} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Updated title' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'Status: in review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const payload = onSave.mock.calls[0]?.[0] as PatchDocumentInput | undefined;
    expect(payload?.title).toBe('Updated title');
    expect(payload?.status_line).toBe('Status: in review');
    expect(typeof payload?.body).toBe('string');
    expect(payload?.body).toContain('Initial content');
  });

  it('renders delete button and calls onDelete after confirm', async () => {
    const onDelete = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(
      <DocumentEditor
        document={sampleDocument}
        mode="editor"
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('inserts an uploaded image as a base64 img node in the saved body', async () => {
    const onSave = vi.fn();

    render(<DocumentEditor document={sampleDocument} mode="editor" onSave={onSave} />);

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

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

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
});
