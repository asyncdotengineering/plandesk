import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HTML_ARTIFACT_CSP,
  MARKDOWN_ARTIFACT_CSP,
  computeSelector,
  renderChrome,
  renderHtmlArtifact,
  renderMarkdownArtifact,
  resolvePreviewTargets,
} from './preview.js';

describe('preview helpers', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'plandesk-prev-'));
    dirs.push(d);
    return d;
  }

  it('computes text selectors with 32-character context', () => {
    const body = `${'p'.repeat(40)}selected${'s'.repeat(40)}`;
    expect(computeSelector(body, 'selected', 40)).toEqual({
      exact: 'selected',
      prefix: 'p'.repeat(32),
      suffix: 's'.repeat(32),
      start: 40,
      end: 48,
    });
  });

  it('computes text selectors at body boundaries', () => {
    expect(computeSelector('first and last', 'first', 0)).toEqual({
      exact: 'first',
      prefix: '',
      suffix: ' and last',
      start: 0,
      end: 5,
    });
    expect(computeSelector('first and last', 'last', 10)).toEqual({
      exact: 'last',
      prefix: 'first and ',
      suffix: '',
      start: 10,
      end: 14,
    });
  });

  it('resolves only existing previewable files, tagging kind by extension', () => {
    const dir = tmp();
    const md = join(dir, 'a.md');
    const html = join(dir, 'b.HTML');
    writeFileSync(md, '# A');
    writeFileSync(html, '<h1>B</h1>');
    const targets = resolvePreviewTargets([md, html, join(dir, 'missing.md'), join(dir, 'note.txt')]);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ index: 0, name: 'a.md', kind: 'markdown' });
    expect(targets[1]).toMatchObject({ index: 1, name: 'b.HTML', kind: 'html' });
    expect(targets[0]?.path.startsWith('/')).toBe(true);
  });

  it('renders markdown to a self-contained document carrying the markdown CSP', () => {
    const doc = renderMarkdownArtifact('# Title\n\n- one\n- two');
    expect(doc).toContain('<h1>Title</h1>');
    expect(doc).toContain('<li>one</li>');
    expect(doc).toContain(MARKDOWN_ARTIFACT_CSP);
    expect(doc).toContain("connect-src 'none'");
  });

  it('injects the html CSP meta into an existing head', () => {
    const out = renderHtmlArtifact('<html><head><title>t</title></head><body>x</body></html>');
    expect(out).toContain(HTML_ARTIFACT_CSP);
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('</head>'));
  });

  it('prepends the html CSP meta when there is no head', () => {
    const out = renderHtmlArtifact('<h1>bare</h1>');
    expect(out.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('uses distinct secure sandboxes for markdown and html frames', () => {
    const chrome = renderChrome([
      { index: 0, path: '/x/a.md', name: 'a.md', kind: 'markdown' },
      { index: 1, path: '/x/b.html', name: 'b.html', kind: 'html' },
    ]);
    const markdownFrame = chrome.match(/<iframe[^>]+src="\/artifact\/0"[^>]*>/)?.[0];
    const htmlFrame = chrome.match(/<iframe[^>]+src="\/artifact\/1"[^>]*>/)?.[0];
    expect(markdownFrame).toContain('sandbox="allow-same-origin"');
    expect(markdownFrame).not.toContain('allow-scripts');
    expect(htmlFrame).toContain('sandbox="allow-scripts"');
    expect(htmlFrame).not.toContain('allow-same-origin');
    expect(chrome).toContain('src="/artifact/0"');
    expect(chrome).toContain('data-idx="1"');
    expect(chrome).toContain('<aside id="rail">');
  });
});
