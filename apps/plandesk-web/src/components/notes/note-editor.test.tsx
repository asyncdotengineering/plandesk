import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PatchNoteInput, SerializedNote } from '../../lib/api.js';
import { NoteEditor } from './NoteEditor.js';

const sampleNote: SerializedNote = {
  id: 'note-1',
  project_id: 'proj-1',
  title: 'Working note',
  body: '<p>Initial content</p>',
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NoteEditor', () => {
  it('calls onSave with title and HTML body', async () => {
    const onSave = vi.fn();

    render(<NoteEditor note={sampleNote} mode="editor" onSave={onSave} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'Renamed note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const payload = onSave.mock.calls[0]?.[0] as PatchNoteInput | undefined;
    expect(payload?.title).toBe('Renamed note');
    expect(typeof payload?.body).toBe('string');
    expect(payload?.body).toContain('Initial content');
  });

  it('renders delete button and calls onDelete after confirm', async () => {
    const onDelete = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(<NoteEditor note={sampleNote} mode="editor" onSave={vi.fn()} onDelete={onDelete} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders legacy markdown bodies as rich text in reader mode', () => {
    const markdownNote: SerializedNote = {
      ...sampleNote,
      body: '## Findings\n\n- one\n- two\n\nA paragraph.',
    };

    render(<NoteEditor note={markdownNote} mode="reader" onSave={vi.fn()} />);

    const reader = document.querySelector('.document-reader-content');
    expect(reader?.querySelector('h2')?.textContent).toBe('Findings');
    expect(reader?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders sanitized reader content without executing scripts', () => {
    const malicious: SerializedNote = {
      ...sampleNote,
      body: '<p>Safe</p><script>alert("xss")</script>',
    };

    render(<NoteEditor note={malicious} mode="reader" onSave={vi.fn()} />);

    expect(screen.getByText('Safe')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });
});
