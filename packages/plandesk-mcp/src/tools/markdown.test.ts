import { describe, expect, it } from 'vitest';
import { ensureHtmlBody } from './markdown.js';

describe('ensureHtmlBody', () => {
  it('converts markdown to HTML', () => {
    const html = ensureHtmlBody('## Hosts\n\n- one\n- two\n\nA paragraph.');
    expect(html).toContain('<h2>Hosts</h2>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<p>A paragraph.</p>');
  });

  it('passes HTML through untouched', () => {
    const html = '<h2>Hosts</h2><p>Already rich text.</p>';
    expect(ensureHtmlBody(html)).toBe(html);
  });

  it('passes empty and whitespace-only bodies through', () => {
    expect(ensureHtmlBody('')).toBe('');
    expect(ensureHtmlBody('  \n')).toBe('  \n');
  });

  it('converts inline markdown emphasis and code', () => {
    const html = ensureHtmlBody('Use `get_next_task` and **never** guess ids.');
    expect(html).toContain('<code>get_next_task</code>');
    expect(html).toContain('<strong>never</strong>');
  });
});
