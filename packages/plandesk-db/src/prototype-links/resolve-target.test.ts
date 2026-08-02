import { describe, expect, it } from 'vitest';
import { resolveTarget, type ResolveTargetScreen } from './resolve-target.js';

const PROTO_A = 'proto-a';
const PROTO_B = 'proto-b';

function screens(list: ResolveTargetScreen[]): ResolveTargetScreen[] {
  return list;
}

describe('resolveTarget (pure, no DB)', () => {
  it('resolves a UUID by id within the project screen list', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const list = screens([
      { id, title: 'Home', prototypeId: PROTO_A },
      { id: '22222222-2222-4222-8222-222222222222', title: 'Other', prototypeId: PROTO_A },
    ]);
    expect(resolveTarget(`plandesk://artifact/${id}`, list, PROTO_A)).toBe(id);
    expect(resolveTarget(id, list, PROTO_A)).toBe(id);
  });

  it('returns null for a missing UUID', () => {
    const list = screens([
      { id: '11111111-1111-4111-8111-111111111111', title: 'Home', prototypeId: PROTO_A },
    ]);
    expect(
      resolveTarget('plandesk://artifact/99999999-9999-4999-8999-999999999999', list, PROTO_A),
    ).toBeNull();
  });

  it('prefers a same-titled screen in its own prototype over another prototype', () => {
    const local = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const list = screens([
      { id: foreign, title: 'Payment', prototypeId: PROTO_B },
      { id: local, title: 'Payment', prototypeId: PROTO_A },
    ]);
    expect(resolveTarget('plandesk://artifact/Payment', list, PROTO_A)).toBe(local);
    expect(resolveTarget('plandesk://artifact/payment', list, PROTO_A)).toBe(local);
  });

  it('falls back to project-wide when the prototype has no title match', () => {
    const only = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const list = screens([
      { id: only, title: 'Checkout', prototypeId: PROTO_B },
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Home', prototypeId: PROTO_A },
    ]);
    expect(resolveTarget('plandesk://artifact/Checkout', list, PROTO_A)).toBe(only);
  });

  it('stores null when the title is missing', () => {
    const list = screens([
      { id: '11111111-1111-4111-8111-111111111111', title: 'Home', prototypeId: PROTO_A },
    ]);
    expect(resolveTarget('plandesk://artifact/Missing', list, PROTO_A)).toBeNull();
  });

  it('stores null when two same-titled screens are in the prototype (ambiguous)', () => {
    const list = screens([
      { id: '11111111-1111-4111-8111-111111111111', title: 'Dup', prototypeId: PROTO_A },
      { id: '22222222-2222-4222-8222-222222222222', title: 'Dup', prototypeId: PROTO_A },
    ]);
    expect(resolveTarget('plandesk://artifact/Dup', list, PROTO_A)).toBeNull();
  });

  it('stores null when two same-titled screens exist only project-wide', () => {
    const list = screens([
      { id: '11111111-1111-4111-8111-111111111111', title: 'Dup', prototypeId: PROTO_B },
      { id: '22222222-2222-4222-8222-222222222222', title: 'Dup', prototypeId: null },
    ]);
    expect(resolveTarget('plandesk://artifact/Dup', list, PROTO_A)).toBeNull();
  });
});
