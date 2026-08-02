import { describe, expect, it } from 'vitest';
import { isExternalUrl, scanScreen } from './scan.js';

describe('scanScreen (pure, no DB)', () => {
  it('extracts three plandesk://artifact/ links', () => {
    const content = `
      <a href="plandesk://artifact/Home">Home</a>
      <a href="plandesk://artifact/Payment">Pay</a>
      <a href="plandesk://artifact/abc-uuid-here">By id shape</a>
    `;
    const result = scanScreen(content);
    expect(result.links).toEqual([
      'plandesk://artifact/Home',
      'plandesk://artifact/Payment',
      'plandesk://artifact/abc-uuid-here',
    ]);
    expect(result.externalRefs).toEqual([]);
  });

  it('extracts library refs and leaves them out of externalRefs', () => {
    const content = `<script src="plandesk://lib/mermaid@11.16.0"></script>
      <script src="plandesk://lib/chart.js@4.5.1"></script>`;
    const result = scanScreen(content);
    expect(result.libs).toEqual([
      'plandesk://lib/mermaid@11.16.0',
      'plandesk://lib/chart.js@4.5.1',
    ]);
    expect(result.externalRefs).toEqual([]);
  });

  it('names all three distinct external references', () => {
    const content = `
      <script src="https://unpkg.com/x"></script>
      <link href="https://cdn.example.com/a.css" rel="stylesheet">
      <img src="//images.example.com/y.png">
    `;
    const result = scanScreen(content);
    expect(result.externalRefs).toHaveLength(3);
    expect(result.externalRefs.map((r) => r.url)).toEqual([
      'https://unpkg.com/x',
      'https://cdn.example.com/a.css',
      '//images.example.com/y.png',
    ]);
    expect(result.externalRefs.map((r) => r.kind)).toEqual(['script', 'style', 'image']);
  });

  it('accepts data:, blob:, and plandesk://file/ without listing them as external', () => {
    const content = `
      <img src="data:image/png;base64,abc">
      <img src="blob:https://example.com/1">
      <img src="plandesk://file/deadbeef">
      <script src="plandesk://lib/mermaid@11.16.0"></script>
    `;
    const result = scanScreen(content);
    expect(result.externalRefs).toEqual([]);
    expect(result.libs).toEqual(['plandesk://lib/mermaid@11.16.0']);
  });

  it('detects @import and @font-face src as style/font externals', () => {
    const content = `
      <style>
        @import url("https://fonts.example/x.css");
        @font-face { font-family: X; src: url("https://fonts.example/x.woff2"); }
      </style>
    `;
    const result = scanScreen(content);
    expect(result.externalRefs).toEqual(
      expect.arrayContaining([
        { kind: 'style', url: 'https://fonts.example/x.css' },
        { kind: 'font', url: 'https://fonts.example/x.woff2' },
      ]),
    );
  });

  it('detects iframe src and absolute srcdoc as frame externals', () => {
    const content = `
      <iframe src="https://evil.example/embed"></iframe>
      <iframe srcdoc="https://evil.example/doc"></iframe>
    `;
    const result = scanScreen(content);
    expect(result.externalRefs.filter((r) => r.kind === 'frame')).toHaveLength(2);
  });

  it('does not treat relative paths as external', () => {
    const content = `<script src="/vendor/x.js"></script><img src="./local.png">`;
    expect(scanScreen(content).externalRefs).toEqual([]);
  });
});

describe('isExternalUrl', () => {
  it.each([
    ['https://x.com', true],
    ['http://x.com', true],
    ['//cdn.x/y', true],
    ['data:text/plain,hi', false],
    ['blob:foo', false],
    ['plandesk://file/a', false],
    ['plandesk://lib/a@1', false],
    ['/relative', false],
    ['./x', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isExternalUrl(url)).toBe(expected);
  });
});
