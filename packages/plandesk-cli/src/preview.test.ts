import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync as writeFile } from 'node:fs';
import { join as joinPath } from 'node:path';
import {
  HTML_ARTIFACT_CSP,
  MARKDOWN_ARTIFACT_CSP,
  annotationRequestHeaders,
  computeSelector,
  previewBackendBanner,
  renderChrome,
  renderHtmlArtifact,
  renderMarkdownArtifact,
  resolvePreviewTargets,
  resolvePreviewWorkspace,
  resolveWithinRoot,
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

  it('computes text selectors with 32-character context', async () => {
    const body = `${'p'.repeat(40)}selected${'s'.repeat(40)}`;
    expect(computeSelector(body, 'selected', 40)).toEqual({
      exact: 'selected',
      prefix: 'p'.repeat(32),
      suffix: 's'.repeat(32),
      start: 40,
      end: 48,
    });
  });

  it('computes text selectors at body boundaries', async () => {
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

  it('resolves only existing previewable files, tagging kind by extension', async () => {
    const dir = tmp();
    const md = join(dir, 'a.md');
    const html = join(dir, 'b.HTML');
    writeFileSync(md, '# A');
    writeFileSync(html, '<h1>B</h1>');
    const targets = resolvePreviewTargets([md, html, join(dir, 'missing.md'), join(dir, 'note.txt')]);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      index: 0,
      name: 'a.md',
      kind: 'markdown',
      mode: 'file',
      root: '',
      rel: '',
    });
    expect(targets[1]).toMatchObject({
      index: 1,
      name: 'b.HTML',
      kind: 'html',
      mode: 'file',
      root: '',
      rel: '',
    });
    expect(targets[0]?.path.startsWith('/')).toBe(true);
  });

  it('resolveWithinRoot keeps subpaths inside root and rejects escapes', async () => {
    const root = tmp();
    const inside = join(root, 'docs', 'page.md');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(inside, '# page');
    expect(resolveWithinRoot(root, 'docs/page.md')).toBe(inside);
    expect(resolveWithinRoot(root, '../escape')).toBeNull();
    expect(resolveWithinRoot(root, '/etc/passwd')).toBeNull();
    expect(resolveWithinRoot(root, 'a/../../escape')).toBeNull();
  });

  it('resolves directory args to folder-mode tabs and file args to file-mode', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.md'), '# A');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'b.html'), '<h1>B</h1>');
    writeFileSync(join(dir, 'logo.png'), 'png');
    const folderTargets = resolvePreviewTargets([dir]);
    expect(folderTargets).toHaveLength(2);
    expect(folderTargets[0]).toMatchObject({
      mode: 'folder',
      root: dir,
      rel: 'a.md',
      name: 'a.md',
      kind: 'markdown',
    });
    expect(folderTargets[1]).toMatchObject({
      mode: 'folder',
      root: dir,
      rel: 'sub/b.html',
      name: 'sub/b.html',
      kind: 'html',
    });
    const fileTargets = resolvePreviewTargets([join(dir, 'a.md')]);
    expect(fileTargets).toHaveLength(1);
    expect(fileTargets[0]).toMatchObject({
      mode: 'file',
      root: '',
      rel: '',
      name: 'a.md',
    });
  });

  it('renders markdown to a self-contained document carrying the markdown CSP', async () => {
    const doc = await renderMarkdownArtifact('# Title\n\n- one\n- two');
    expect(doc).toContain('<h1>Title</h1>');
    expect(doc).toContain('<li>one</li>');
    expect(doc).toContain(MARKDOWN_ARTIFACT_CSP);
    expect(doc).toContain("connect-src 'none'");
  });

  it('highlights fenced code blocks with Shiki', async () => {
    const doc = await renderMarkdownArtifact('```ts\nconst x = 1;\n```');
    expect(doc).toContain('class="shiki"');
    expect(doc).toContain('style="color:');
  });

  it('emits mermaid containers instead of Shiki for mermaid fenced blocks', async () => {
    const doc = await renderMarkdownArtifact('```mermaid\ngraph TD; A-->B;\n```');
    expect(doc).toContain('<pre class="mermaid">');
    expect(doc).not.toContain('class="shiki"');
  });

  it('renders GFM tables as html table elements', async () => {
    const doc = await renderMarkdownArtifact('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(doc).toContain('<table>');
  });

  it('injects the html CSP meta into an existing head', async () => {
    const out = renderHtmlArtifact('<html><head><title>t</title></head><body>x</body></html>');
    expect(out).toContain(HTML_ARTIFACT_CSP);
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('</head>'));
  });

  it('prepends the html CSP meta when there is no head', async () => {
    const out = renderHtmlArtifact('<h1>bare</h1>');
    expect(out.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it('uses distinct secure sandboxes for markdown and html frames', async () => {
    const chrome = renderChrome([
      {
        index: 0,
        path: '/x/a.md',
        name: 'a.md',
        kind: 'markdown',
        mode: 'file',
        root: '',
        rel: '',
      },
      {
        index: 1,
        path: '/x/b.html',
        name: 'b.html',
        kind: 'html',
        mode: 'file',
        root: '',
        rel: '',
      },
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

  it('uses folder-mode tree URLs and same-origin sandboxes without scripts', async () => {
    const chrome = renderChrome([
      {
        index: 0,
        path: '/x/rfcs/a.html',
        name: 'rfcs/a.html',
        kind: 'html',
        mode: 'folder',
        root: '/x',
        rel: 'rfcs/a.html',
      },
      {
        index: 1,
        path: '/x/b.html',
        name: 'b.html',
        kind: 'html',
        mode: 'file',
        root: '',
        rel: '',
      },
    ]);
    const folderFrame = chrome.match(/<iframe[^>]+src="\/tree\/0\/rfcs\/a\.html"[^>]*>/)?.[0];
    const fileFrame = chrome.match(/<iframe[^>]+src="\/artifact\/1"[^>]*>/)?.[0];
    expect(folderFrame).toContain('sandbox="allow-same-origin"');
    expect(folderFrame).not.toContain('allow-scripts');
    expect(folderFrame?.startsWith('<iframe')).toBe(true);
    expect(fileFrame).toContain('sandbox="allow-scripts"');
    expect(fileFrame).not.toContain('allow-same-origin');
    expect(chrome).toContain('src="/tree/0/rfcs/a.html"');
  });

  it('detects a connected-repo workspace (config + token) for annotation routing', async () => {
    const dir = tmp();
    // No .plandesk yet → standalone (sidecar).
    expect(resolvePreviewWorkspace(dir)).toBeUndefined();
    expect(previewBackendBanner(undefined)).toBe('annotations → local sidecar');

    mkdirSync(joinPath(dir, '.plandesk'));
    writeFile(
      joinPath(dir, '.plandesk', 'config.json'),
      JSON.stringify({
        version: 'plandesk-connect-v1',
        serverUrl: 'http://127.0.0.1:3999',
        projectId: '9688c8b4-8472-4d4a-ba8b-c60de3d3a301',
        projectName: 'x',
      }),
    );
    writeFile(joinPath(dir, '.plandesk', 'token'), 'plandesk_mcp_test');
    expect(resolvePreviewWorkspace(dir)).toEqual({
      serverUrl: 'http://127.0.0.1:3999',
      projectId: '9688c8b4-8472-4d4a-ba8b-c60de3d3a301',
      token: 'plandesk_mcp_test',
    });
    expect(annotationRequestHeaders('plandesk_mcp_test')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer plandesk_mcp_test',
    });
  });

  it('selects the board API on loopback when config exists without a token', async () => {
    const dir = tmp();
    mkdirSync(joinPath(dir, '.plandesk'));
    writeFile(
      joinPath(dir, '.plandesk', 'config.json'),
      JSON.stringify({
        version: 'plandesk-connect-v1',
        serverUrl: 'http://127.0.0.1:7526',
        projectId: '9688c8b4-8472-4d4a-ba8b-c60de3d3a301',
        projectName: 'x',
      }),
    );
    const workspace = resolvePreviewWorkspace(dir);
    expect(workspace).toEqual({
      serverUrl: 'http://127.0.0.1:7526',
      projectId: '9688c8b4-8472-4d4a-ba8b-c60de3d3a301',
    });
    expect(previewBackendBanner(workspace)).toBe(
      'annotations → http://127.0.0.1:7526 (project 9688c8b4-8472-4d4a-ba8b-c60de3d3a301)',
    );
    expect(annotationRequestHeaders(workspace?.token)).toEqual({
      'Content-Type': 'application/json',
    });
    expect(annotationRequestHeaders(workspace?.token)).not.toHaveProperty('Authorization');
  });

  it('falls back to the local sidecar only when unbound (no config)', async () => {
    const dir = tmp();
    mkdirSync(joinPath(dir, '.plandesk'));
    expect(resolvePreviewWorkspace(dir)).toBeUndefined();
    expect(previewBackendBanner(undefined)).toBe('annotations → local sidecar');
  });
});
