import { describe, expect, it } from 'vitest';
import { resolveNavigate } from './navigate-target.js';
import type { SerializedArtifact, SerializedPrototypeLink } from '@/lib/api.js';

const screens: SerializedArtifact[] = [
  {
    id: 'a',
    project_id: 'p',
    title: 'Home',
    kind: 'html',
    content: '',
    prototype_id: 'proto-1',
    folder_id: null,
    x: 0,
    y: 0,
    revision_id: 'r1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'b',
    project_id: 'p',
    title: 'Pay',
    kind: 'html',
    content: '',
    prototype_id: 'proto-1',
    folder_id: null,
    x: 0,
    y: 1000,
    revision_id: 'r2',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const links: SerializedPrototypeLink[] = [
  {
    id: 'l1',
    project_id: 'p',
    from_artifact_id: 'a',
    to_artifact_id: 'b',
    raw_target: 'plandesk://artifact/Pay',
  },
  {
    id: 'l2',
    project_id: 'p',
    from_artifact_id: 'a',
    to_artifact_id: null,
    raw_target: 'plandesk://artifact/Missing',
  },
];

describe('resolveNavigate', () => {
  it('centres on a resolved write-time link without inventing edges', () => {
    expect(resolveNavigate('a', 'plandesk://artifact/Pay', links, screens, 'proto-1')).toEqual({
      kind: 'go',
      artifactId: 'b',
      prototypeId: 'proto-1',
    });
  });

  it('surfaces a broken null-target link and does not navigate', () => {
    expect(resolveNavigate('a', 'plandesk://artifact/Missing', links, screens, 'proto-1')).toEqual({
      kind: 'broken',
      reason: 'Unresolved link: plandesk://artifact/Missing',
      rawTarget: 'plandesk://artifact/Missing',
    });
  });

  it('falls back to title match for a runtime link with no row', () => {
    expect(resolveNavigate('a', 'plandesk://artifact/Pay', [], screens, 'proto-1')).toEqual({
      kind: 'go',
      artifactId: 'b',
      prototypeId: 'proto-1',
    });
  });

  it('reports unresolved when nothing matches', () => {
    expect(resolveNavigate('a', 'plandesk://artifact/Nope', [], screens, 'proto-1')).toEqual({
      kind: 'unresolved',
      reason: 'No screen matches plandesk://artifact/Nope',
      rawTarget: 'plandesk://artifact/Nope',
    });
  });
});
