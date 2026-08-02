import { describe, expect, it } from 'vitest';
import { resolveAnchor, parseStoredAnchor } from './resolve-anchor.js';
import {
  createScreenCommentsStore,
  parseFrameReady,
  parseFrameSelection,
  passageFromSelector,
} from './screen-comments.js';

describe('resolveAnchor', () => {
  const textSel = {
    mode: 'text' as const,
    quote: 'purple widgets',
    prefix: 'about ',
    suffix: '.',
    start: 10,
    end: 24,
    revisionId: 'rev-1',
  };

  it('resolves a light edit to the edited sentence', () => {
    const frame = 'Talk about purple widgetz. More.';
    const r = resolveAnchor(frame, textSel, 'rev-2');
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.stale).toBe(true);
      expect(frame.slice(r.start, r.end)).toContain('purple');
    }
  });

  it('orphans when the quote is gone — never attaches to different text', () => {
    const frame = 'Talk about green gadgets. More.';
    const r = resolveAnchor(frame, textSel, 'rev-1');
    expect(r.status).toBe('orphan');
  });

  it('marks stale when revisionId differs even if quote still matches', () => {
    const frame = 'Talk about purple widgets. More.';
    const r = resolveAnchor(frame, textSel, 'rev-2');
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') {
      expect(r.stale).toBe(true);
    }
  });

  it('returns point anchors without matching', () => {
    const r = resolveAnchor(undefined, { mode: 'point', x: 12, y: 34, revisionId: 'r' }, 'r');
    expect(r).toEqual({ status: 'point', x: 12, y: 34, stale: false });
  });
});

describe('parseStoredAnchor', () => {
  it('round-trips shim text selector JSON', () => {
    const raw = JSON.stringify({
      mode: 'text',
      quote: 'q',
      prefix: 'p',
      suffix: 's',
      start: 1,
      end: 2,
      revisionId: 'r',
    });
    expect(parseStoredAnchor(raw)?.mode).toBe('text');
  });

  it('returns null for garbage', () => {
    expect(parseStoredAnchor('{')).toBeNull();
    expect(parseStoredAnchor(null)).toBeNull();
  });
});

describe('screen-comments store', () => {
  it('stores frame text and pending drafts', () => {
    const store = createScreenCommentsStore();
    let ticks = 0;
    store.subscribe(() => {
      ticks += 1;
    });
    store.setFrameText('a1', 'Hello');
    expect(store.getFrameText('a1')).toBe('Hello');
    store.setPending({
      artifactId: 'a1',
      selector: { mode: 'point', x: 1, y: 2, revisionId: 'r' },
      rect: { x: 1, y: 2, width: 0, height: 0 },
      passage: null,
    });
    expect(store.getPending()?.artifactId).toBe('a1');
    expect(ticks).toBeGreaterThanOrEqual(2);
  });

  it('parses ready and selection messages', () => {
    expect(parseFrameReady({ kind: 'plandesk:ready', text: 'Hi', height: 10 })).toEqual({
      text: 'Hi',
      height: 10,
    });
    const sel = parseFrameSelection({
      kind: 'plandesk:selection',
      selector: { mode: 'point', x: 3, y: 4, revisionId: 'r' },
      rect: { x: 3, y: 4, width: 0, height: 0 },
    });
    expect(sel?.selector.mode).toBe('point');
    if (sel === null) {
      return;
    }
    expect(passageFromSelector(sel.selector)).toBeNull();
  });
});
