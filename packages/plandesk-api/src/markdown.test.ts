import { afterEach, describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { convertDocumentBody, ensureHtmlBody } from './markdown.js';

const NO_WIKI_FIXTURE = `## Hosts

- one
- two

A paragraph with [a link](https://example.com).

\`\`\`js
const x = 1;
\`\`\`

Use \`inline\` and **bold**.`;

describe('ensureHtmlBody', () => {
  afterEach(() => {
    marked.setOptions({ async: false });
  });

  it('renders markdown even when the shared marked singleton is polluted with an async extension', () => {
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

  it('leaves bodies without wiki-links byte-identical to the pre-wiki-link converter', () => {
    const baseline = marked.parse(NO_WIKI_FIXTURE, { async: false, gfm: true });
    expect(ensureHtmlBody(NO_WIKI_FIXTURE)).toBe(baseline);
  });
});

describe('wiki-links', () => {
  const docs = new Map<string, { id: string; title: string }>([
    ['existing doc', { id: 'doc-target', title: 'Existing Doc' }],
    ['`get_next_task`', { id: 'doc-code', title: '`get_next_task`' }],
    ['foo_bar*baz*', { id: 'doc-md', title: 'foo_bar*baz*' }],
  ]);
  const resolve = (title: string) => docs.get(title.toLowerCase());

  it('renders a resolved wiki-link as an anchor', () => {
    const { html } = convertDocumentBody('See [[Existing Doc]] for details.', {
      projectId: 'proj-1',
      resolve,
    });
    expect(html).toContain('<a href="/projects/proj-1/documents/doc-target">Existing Doc</a>');
    expect(html).not.toContain('[[');
  });

  it('renders alias syntax with display text', () => {
    const { html } = convertDocumentBody('Read [[Existing Doc|see the spec]] now.', {
      projectId: 'proj-1',
      resolve,
    });
    expect(html).toContain('<a href="/projects/proj-1/documents/doc-target">see the spec</a>');
    expect(html).not.toContain('Existing Doc|');
  });

  it('renders unresolved wiki-links as visibly broken spans', () => {
    const { html } = convertDocumentBody('Missing [[No Such Doc]] here.');
    expect(html).toContain('class="wikilink-unresolved"');
    expect(html).toContain('No Such Doc');
    expect(html).not.toContain('[[');
  });

  it('resolves titles with markdown characters on literal text', () => {
    const { html } = convertDocumentBody('Call [[`get_next_task`]] and [[foo_bar*baz*]].', {
      resolve,
    });
    expect(html).toContain('<a href="/documents/doc-code">`get_next_task`</a>');
    expect(html).toContain('<a href="/documents/doc-md">foo_bar*baz*</a>');
    expect(html).not.toContain('<code>get_next_task</code>');
    expect(html).not.toContain('<strong>baz</strong>');
  });

  it('reports resolved targets for edge creation', () => {
    const { resolved } = convertDocumentBody('[[Existing Doc]] and [[Existing Doc]] again.', {
      resolve,
    });
    expect(resolved).toEqual([{ id: 'doc-target', title: 'Existing Doc' }]);
  });

  it('does not resolve when no resolver is provided', () => {
    const { html, resolved } = convertDocumentBody('[[Existing Doc]]');
    expect(resolved).toEqual([]);
    expect(html).toContain('class="wikilink-unresolved"');
  });

  it('leaves wiki-links inside fenced code untouched', () => {
    const body = '```\n[[not a link]]\n```\n\nReal [[No Such Doc]]';
    const { html } = convertDocumentBody(body, { resolve });
    expect(html).toContain('[[not a link]]');
    expect(html).toContain('class="wikilink-unresolved"');
  });
});
