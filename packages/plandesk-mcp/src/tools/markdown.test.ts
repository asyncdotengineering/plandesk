import { afterEach, describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { ensureHtmlBody } from './markdown.js';

describe('ensureHtmlBody', () => {
  afterEach(() => {
    // Undo any pollution of the shared singleton so it cannot leak into other tests.
    marked.setOptions({ async: false });
  });

  it('renders markdown even when the shared marked singleton is polluted with an async extension', () => {
    // The CLI previewer registers an async marked-shiki extension at import time,
    // which flips the process-global `marked` singleton into async mode. Because
    // `plandesk serve` runs the CLI and the MCP server in one process sharing one
    // `marked` instance, server-side body rendering must not depend on that global
    // state — otherwise every non-empty document/note body write throws
    // "The async option was set to true by an extension".
    marked.use({ async: true });
    const html = ensureHtmlBody('## Heading\n\nsome **markdown**');
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<strong>markdown</strong>');
  });
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
