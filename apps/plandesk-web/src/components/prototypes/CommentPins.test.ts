import { describe, expect, it } from 'vitest';
import { computePinStyle } from './CommentPins.js';

describe('computePinStyle', () => {
  it('places pin in screen space and counter-scales by 1/zoom', () => {
    const at1 = computePinStyle(
      { x: 100, y: 200 },
      { x: 10, y: 20, width: 5, height: 5 },
      {
        x: 0,
        y: 0,
        zoom: 1,
      },
    );
    expect(at1.left).toBe(110);
    expect(at1.top).toBe(220);
    expect(at1.transform).toBe('scale(1)');

    const atHalf = computePinStyle(
      { x: 100, y: 200 },
      { x: 10, y: 20, width: 5, height: 5 },
      { x: 0, y: 0, zoom: 0.5 },
    );
    expect(atHalf.left).toBe(55);
    expect(atHalf.top).toBe(110);
    expect(atHalf.transform).toBe('scale(2)');
  });

  it('applies viewport translation', () => {
    const s = computePinStyle(
      { x: 0, y: 0 },
      { x: 10, y: 10, width: 0, height: 0 },
      {
        x: 40,
        y: 50,
        zoom: 1,
      },
    );
    expect(s.left).toBe(50);
    expect(s.top).toBe(60);
  });
});
