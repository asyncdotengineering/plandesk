import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor.js';

const GFM_TABLE = ['| Col A | Col B |', '| --- | --- |', '| 1 | 2 |'].join('\n');

afterEach(() => {
  cleanup();
});

describe('RichTextEditor', () => {
  it('renders a GFM Markdown table as an HTML table in reader mode (#9)', () => {
    render(<RichTextEditor value={GFM_TABLE} mode="reader" />);

    const reader = document.querySelector('.document-reader-content');
    expect(reader?.querySelector('table')).toBeTruthy();
    expect(reader?.querySelectorAll('th')).toHaveLength(2);
    expect(reader?.querySelector('th')?.textContent).toBe('Col A');
    const cells = Array.from(reader?.querySelectorAll('td') ?? []).map((c) => c.textContent);
    expect(cells).toEqual(['1', '2']);
  });

  it('keeps a table node in the editor so getHTML() does not drop it', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(<RichTextEditor ref={ref} value={GFM_TABLE} mode="editor" />);

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content table')).toBeTruthy();
    });

    expect(ref.current?.getHTML()).toContain('<table');
  });

  it('serializes a table back to GFM Markdown (round-trips, not HTML)', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(<RichTextEditor ref={ref} value={GFM_TABLE} mode="editor" />);

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content table')).toBeTruthy();
    });

    const markdown = ref.current?.getMarkdown() ?? '';
    expect(markdown).toContain('Col A');
    expect(markdown).toContain('Col B');
    expect(markdown).toContain('|');
    expect(markdown).not.toContain('<table');

    // The strongest proof: the emitted Markdown renders back to a real table.
    cleanup();
    render(<RichTextEditor value={markdown} mode="reader" />);
    const reader = document.querySelector('.document-reader-content');
    expect(reader?.querySelector('table')).toBeTruthy();
    const cells = Array.from(reader?.querySelectorAll('td') ?? []).map((c) => c.textContent);
    expect(cells).toEqual(['1', '2']);
  });

  it('serializes formatted text back to Markdown, not HTML (task-description contract)', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(
      <RichTextEditor ref={ref} value={'## Problem\n\n**Bold** and a point.'} mode="editor" />,
    );

    await waitFor(() => {
      expect(screen.getByText('Problem')).toBeTruthy();
    });

    const markdown = ref.current?.getMarkdown() ?? '';
    expect(markdown).toContain('## Problem');
    expect(markdown).toContain('**Bold**');
    expect(markdown).not.toContain('<h2');
    expect(markdown).not.toContain('<strong');
  });

  it('is clean until edited, then reports dirty so callers can skip a no-op re-serialize', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(<RichTextEditor ref={ref} value="Start" mode="editor" />);

    await waitFor(() => {
      expect(screen.getByText('Start')).toBeTruthy();
    });
    expect(ref.current?.isDirty()).toBe(false);

    // A toolbar action mutates the document — the dirty flag must flip.
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    await waitFor(() => {
      expect(document.querySelector('.document-editor-content table')).toBeTruthy();
    });

    expect(ref.current?.isDirty()).toBe(true);
    expect(ref.current?.getMarkdown()).toContain('|');
  });
});
