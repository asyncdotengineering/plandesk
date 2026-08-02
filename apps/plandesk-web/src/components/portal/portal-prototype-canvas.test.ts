import { describe, expect, it } from 'vitest';
import type { ClientViewPrototype } from '@/lib/portal.js';
import { portalPrototypeToCanvas } from './PortalPrototypeCanvas.js';
import { prototypeToFlow } from '../prototypes/PrototypeCanvas.js';

const prototype: ClientViewPrototype = {
  id: 'prototype-1',
  name: 'Client checkout',
  viewport_width: 390,
  viewport_height: 844,
  screens: [
    {
      id: 'screen-1',
      title: 'Cart',
      kind: 'html',
      content: '<p>Cart</p>',
      x: 24,
      y: 48,
      revision_id: '2026-08-02T12:00:00.000Z',
    },
    {
      id: 'screen-2',
      title: 'Pay',
      kind: 'html',
      content: '<p>Pay</p>',
      x: 500,
      y: 48,
      revision_id: '2026-08-02T12:01:00.000Z',
    },
  ],
  links: [
    {
      id: 'link-1',
      from_artifact_id: 'screen-1',
      to_artifact_id: 'screen-2',
      raw_target: 'plandesk://artifact/screen-2',
    },
  ],
};

describe('portal prototype canvas mapping', () => {
  it('maps projected screens into the shared renderer with token-bearing, read-only frames', () => {
    const canvas = portalPrototypeToCanvas(prototype, 'project-1');
    const { nodes, edges } = prototypeToFlow(canvas, {
      frameToken: 'plandesk_share_guest',
      readOnly: true,
    });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual(
      expect.objectContaining({
        id: 'screen-1',
        position: { x: 24, y: 48 },
        width: 390,
        height: 844,
      }),
    );
    expect(nodes[0]?.data).toMatchObject({
      revisionId: '2026-08-02T12:00:00.000Z',
      frameToken: 'plandesk_share_guest',
      readOnly: true,
    });
    expect(nodes.some((node) => node.data.readOnly !== true)).toBe(false);
    expect(edges).toEqual([
      expect.objectContaining({ id: 'link-1', source: 'screen-1', target: 'screen-2' }),
    ]);
  });
});
