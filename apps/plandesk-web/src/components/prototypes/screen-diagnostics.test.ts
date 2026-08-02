import { describe, expect, it } from 'vitest';
import { createScreenDiagnosticsStore, parseFrameDiagnostic } from './screen-diagnostics.js';

describe('screen diagnostics store', () => {
  it('parses blocked and error frame messages', () => {
    expect(
      parseFrameDiagnostic({
        kind: 'plandesk:blocked',
        directive: 'script-src',
        blockedUri: 'https://unpkg.com/x',
      }),
    ).toMatchObject({
      kind: 'blocked',
      directive: 'script-src',
      blockedUri: 'https://unpkg.com/x',
    });
    expect(parseFrameDiagnostic({ kind: 'plandesk:error', message: 'boom' })).toMatchObject({
      kind: 'error',
      message: 'boom',
    });
    expect(parseFrameDiagnostic({ kind: 'plandesk:ready' })).toBeNull();
  });

  it('clears per artifact and leaves others alone', () => {
    const store = createScreenDiagnosticsStore();
    store.push('a', { kind: 'error', message: 'a', at: 1 });
    store.push('b', { kind: 'error', message: 'b', at: 2 });
    store.clear('a');
    expect(store.get('a')).toEqual([]);
    expect(store.get('b')).toHaveLength(1);
  });

  it('returns a stable empty list and snapshot when unchanged', () => {
    const store = createScreenDiagnosticsStore();
    expect(store.get('missing')).toBe(store.get('missing'));
    expect(store.snapshot()).toBe(store.snapshot());
  });
});
