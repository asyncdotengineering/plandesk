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

  it('renders task-list markdown as task items in reader mode', () => {
    render(<RichTextEditor value={'- [x] a\n- [ ] b'} mode="reader" />);

    const items = document.querySelectorAll('.document-reader-content li[data-type="taskItem"]');
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('data-checked')).toBe('true');
    expect(items[1]?.getAttribute('data-checked')).toBe('false');
  });

  it('round-trips GFM task-list checkboxes through the editor', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(<RichTextEditor ref={ref} value={'- [x] a\n- [ ] b'} mode="editor" />);

    await waitFor(() => {
      expect(
        document.querySelector(
          '.document-editor-content ul[data-type="taskList"] input[type="checkbox"]',
        ),
      ).toBeTruthy();
    });

    const markdown = ref.current?.getMarkdown() ?? '';
    // Tolerant of turndown's native "-   " marker spacing; the load path re-parses
    // it as a checkbox regardless (verified). The contract is Markdown, not HTML.
    expect(markdown).toMatch(/-\s+\[x\] a/);
    expect(markdown).toMatch(/-\s+\[ \] b/);
    expect(markdown).not.toContain('<input');
    expect(markdown).not.toContain('data-type');
    expect(markdown).not.toContain('<li');
  });

  it('does not convert plain bullet lists into task items', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(<RichTextEditor ref={ref} value={'- one\n- two'} mode="editor" />);

    await waitFor(() => {
      expect(screen.getByText('one')).toBeTruthy();
    });

    const markdown = ref.current?.getMarkdown() ?? '';
    // Plain bullets, never task items — tolerant of turndown's "-   " marker spacing.
    expect(markdown).toMatch(/^-\s+one$/m);
    expect(markdown).toMatch(/^-\s+two$/m);
    expect(markdown).not.toContain('[');
  });

  it('keeps an annotated image as raw HTML in getMarkdown so annotations survive a Markdown body', async () => {
    const ref = createRef<RichTextEditorHandle>();
    const annotated =
      '<img src="data:image/png;base64,AAAA" alt="shot" data-original="data:image/png;base64,BBBB" ' +
      `data-annotations='[{"id":"a1","type":"arrow","x":1,"y":2,"w":3,"h":4,"color":"#000"}]'>`;
    render(<RichTextEditor ref={ref} value={annotated} mode="editor" />);

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content img')).toBeTruthy();
    });

    const markdown = ref.current?.getMarkdown() ?? '';
    // Re-editable annotations can't survive a Markdown image, so it stays raw HTML.
    expect(markdown).toContain('<img');
    expect(markdown).toContain('data-annotations');
    expect(markdown).not.toContain('![');
  });

  it('serializes a plain (un-annotated) image as a Markdown image', async () => {
    const ref = createRef<RichTextEditorHandle>();
    render(
      <RichTextEditor ref={ref} value={'<img src="data:image/png;base64,AAAA" alt="pic">'} mode="editor" />,
    );

    await waitFor(() => {
      expect(document.querySelector('.document-editor-content img')).toBeTruthy();
    });

    const markdown = ref.current?.getMarkdown() ?? '';
    expect(markdown).toContain('![');
    expect(markdown).not.toContain('data-annotations');
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
