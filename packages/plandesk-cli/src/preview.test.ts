import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HTML_ARTIFACT_CSP,
  MARKDOWN_ARTIFACT_CSP,
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

  it('frames markdown without allow-scripts and html with allow-scripts', () => {
    const chrome = renderChrome([
      { index: 0, path: '/x/a.md', name: 'a.md', kind: 'markdown' },
      { index: 1, path: '/x/b.html', name: 'b.html', kind: 'html' },
    ]);
    expect(chrome).toContain('sandbox=""');
    expect(chrome).toContain('sandbox="allow-scripts"');
    expect(chrome).toContain('src="/artifact/0"');
    expect(chrome).toContain('data-idx="1"');
  });
});
