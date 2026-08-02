import { describe, expect, it } from 'vitest';
import { computePrototypeLayout, navigationOrder } from './prototype-layout.js';

describe('navigationOrder', () => {
  it('orders screens along resolved links', () => {
    expect(
      navigationOrder(
        ['b', 'a', 'c'],
        [
          { fromArtifactId: 'a', toArtifactId: 'b' },
          { fromArtifactId: 'b', toArtifactId: 'c' },
        ],
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('ignores null-target links for ranking', () => {
    expect(navigationOrder(['a', 'b'], [{ fromArtifactId: 'a', toArtifactId: null }])).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('computePrototypeLayout', () => {
  it('stacks null-coord screens in navigation order', () => {
    const positions = computePrototypeLayout(
      [
        { id: 'a', x: null, y: null },
        { id: 'b', x: null, y: null },
      ],
      [{ fromArtifactId: 'a', toArtifactId: 'b' }],
      900,
    );
    expect(positions.get('a')).toEqual({ x: 0, y: 0 });
    expect(positions.get('b')?.y).toBeGreaterThan(positions.get('a')?.y ?? 0);
  });

  it('preserves already-placed screens', () => {
    const positions = computePrototypeLayout(
      [
        { id: 'a', x: 10, y: 20 },
        { id: 'b', x: null, y: null },
      ],
      [{ fromArtifactId: 'a', toArtifactId: 'b' }],
      100,
    );
    expect(positions.get('a')).toEqual({ x: 10, y: 20 });
    expect(positions.get('b')?.y).toBeGreaterThanOrEqual(20 + 100);
  });
});
