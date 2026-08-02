import { describe, expect, it } from 'vitest';
import { prototypeToFlow } from './PrototypeCanvas.js';
import type { SerializedPrototypeWithScreens } from '@/lib/api.js';

const base: SerializedPrototypeWithScreens = {
  id: 'proto-1',
  project_id: 'proj-1',
  name: 'Checkout',
  viewport_width: 390,
  viewport_height: 844,
  folder_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  screens: [
    {
      id: 'a',
      project_id: 'proj-1',
      title: 'Home',
      kind: 'html',
      content: '',
      prototype_id: 'proto-1',
      x: 0,
      y: 0,
      revision_id: 'rev-a',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'b',
      project_id: 'proj-1',
      title: 'Pay',
      kind: 'html',
      content: '',
      prototype_id: 'proto-1',
      x: 0,
      y: 1000,
      revision_id: 'rev-b',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  links: [
    {
      id: 'l1',
      project_id: 'proj-1',
      from_artifact_id: 'a',
      to_artifact_id: 'b',
      raw_target: 'plandesk://artifact/Pay',
    },
    {
      id: 'l2',
      project_id: 'proj-1',
      from_artifact_id: 'a',
      to_artifact_id: null,
      raw_target: 'plandesk://artifact/Missing',
    },
  ],
};

describe('prototypeToFlow', () => {
  it('sizes every node to the prototype viewport', () => {
    const { nodes } = prototypeToFlow(base);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.width).toBe(390);
      expect(node.height).toBe(844);
      expect(node.data.width).toBe(390);
      expect(node.data.height).toBe(844);
    }
  });

  it('draws resolved links as edges and surfaces broken stubs on the source', () => {
    const { nodes, edges } = prototypeToFlow(base);
    expect(edges).toEqual([expect.objectContaining({ id: 'l1', source: 'a', target: 'b' })]);
    expect(nodes.find((n) => n.id === 'a')?.data.brokenLinks).toEqual([
      'plandesk://artifact/Missing',
    ]);
    expect(nodes.find((n) => n.id === 'b')?.data.brokenLinks).toEqual([]);
  });
});
