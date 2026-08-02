// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildTextAnchor, offsetsToRange } from './html-frame-shim.js';

describe('buildTextAnchor', () => {
  it('captures quote, context, and revisionId from offsets into fullText', () => {
    const full = 'alpha bravo charlie delta';
    const start = full.indexOf('bravo');
    const end = start + 'bravo'.length;
    const anchor = buildTextAnchor(full, start, end, 'rev-1');
    expect(anchor).toEqual({
      mode: 'text',
      quote: 'bravo',
      prefix: 'alpha ',
      suffix: ' charlie delta',
      start,
      end,
      revisionId: 'rev-1',
    });
  });

  it('truncates long quotes and keeps suffix after the truncated quote', () => {
    const quote = 'x'.repeat(1200);
    const full = `pre-${quote}-post`;
    const start = 4;
    const end = start + quote.length;
    const anchor = buildTextAnchor(full, start, end, 'r');
    expect(anchor.mode).toBe('text');
    if (anchor.mode !== 'text') return;
    expect(anchor.quote.length).toBe(1000);
    expect(anchor.suffix.startsWith('x')).toBe(true);
    expect(anchor.end).toBe(start + 1000);
  });
});

describe('offsetsToRange', () => {
  it('resolves offsets that span a text-node boundary', () => {
    document.body.innerHTML = '<p>Hello</p><p>World</p>';
    const full = document.body.textContent || '';
    expect(full).toBe('HelloWorld');
    // offsets 3..8 → "loWor" across the two text nodes
    const range = offsetsToRange(document.body, 3, 8);
    expect(range).not.toBeNull();
    if (range === null) {
      return;
    }
    expect(range.toString()).toBe('loWor');
    expect(range.startContainer).not.toBe(range.endContainer);
  });

  it('round-trips characters from body.textContent offsets', () => {
    document.body.innerHTML = '<div>ab<span>cd</span>ef</div>';
    const text = document.body.textContent || '';
    const start = text.indexOf('bc');
    const end = start + 2;
    const range = offsetsToRange(document.body, start, end);
    expect(range).not.toBeNull();
    if (range === null) {
      return;
    }
    expect(range.toString()).toBe(text.slice(start, end));
  });

  it('returns null for stale offsets beyond textContent — never clamps', () => {
    document.body.innerHTML = '<p>short</p>';
    const len = (document.body.textContent || '').length;
    expect(offsetsToRange(document.body, 0, len + 1)).toBeNull();
    expect(offsetsToRange(document.body, len + 1, len + 2)).toBeNull();
    expect(offsetsToRange(document.body, 3, 2)).toBeNull();
    expect(offsetsToRange(document.body, -1, 2)).toBeNull();
  });
});
