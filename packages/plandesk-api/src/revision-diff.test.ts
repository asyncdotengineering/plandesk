import { describe, expect, it } from 'vitest';
import { diffFieldValues, htmlToMarkdown } from './revision-diff.js';

describe('revision-diff Markdown projection', () => {
  it('projects a one-word HTML paragraph change to a one-line Markdown diff', () => {
    const oldHtml = '<p>The quick brown fox jumps over the lazy dog.</p>';
    const newHtml = '<p>The quick red fox jumps over the lazy dog.</p>';

    // Sanity: raw HTML differs only inside the same tag — but a naive HTML
    // line-diff still replaces the whole <p>…</p> line.
    expect(oldHtml.split('\n')).toHaveLength(1);
    expect(newHtml.split('\n')).toHaveLength(1);

    const projected = diffFieldValues('body', oldHtml, newHtml, {
      projectBodyAsMarkdown: true,
    });
    expect(projected).toBeDefined();
    if (!projected) {
      return;
    }
    expect(projected.field).toBe('body');
    expect(projected.hunks).toHaveLength(1);
    const lines = projected.hunks[0]?.lines ?? [];
    const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---'));
    const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    expect(removed).toEqual(['-The quick brown fox jumps over the lazy dog.']);
    expect(added).toEqual(['+The quick red fox jumps over the lazy dog.']);
    // Prove we are not emitting HTML tags in the hunk.
    expect(lines.every((line) => !line.includes('<p>') && !line.includes('</p>'))).toBe(true);
  });

  it('diffs a task description as plain text with no projection', () => {
    const projected = diffFieldValues('description', 'alpha', 'beta', {
      projectBodyAsMarkdown: false,
    });
    expect(projected?.hunks).toHaveLength(1);
    const lines = projected?.hunks[0]?.lines ?? [];
    expect(lines).toContain('-alpha');
    expect(lines).toContain('+beta');
  });

  it('turndown strips paragraph wrappers for a single line', () => {
    expect(htmlToMarkdown('<p>Hello world</p>')).toBe('Hello world');
  });
});
