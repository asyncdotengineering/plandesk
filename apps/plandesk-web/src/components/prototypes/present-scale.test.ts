import { describe, expect, it } from 'vitest';
import { fitScale, stepIndex } from './present-scale.js';

// A prototype declares one viewport for every screen, and that viewport
// routinely exceeds the window a reviewer opens the share link in. Cropping
// hides the part they were sent to look at.
describe('fitScale', () => {
  it('shrinks a screen larger than the window, preserving aspect ratio', () => {
    expect(fitScale({ width: 1280, height: 720 }, { width: 1440, height: 900 })).toBeCloseTo(0.8);
  });

  it('is bound by the tighter axis', () => {
    // Width would allow 2x; height allows 0.5. The screen must still fit.
    expect(fitScale({ width: 2000, height: 400 }, { width: 1000, height: 800 })).toBeCloseTo(0.5);
  });

  it('never magnifies past 1 — an upscaled screen is not the design under review', () => {
    expect(fitScale({ width: 2560, height: 1440 }, { width: 390, height: 844 })).toBe(1);
  });

  it('returns 1 before the container has been measured', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 390, height: 844 })).toBe(1);
  });

  it('returns 1 for a degenerate viewport rather than dividing by zero', () => {
    expect(fitScale({ width: 1280, height: 720 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe('stepIndex', () => {
  it('steps forward and back', () => {
    expect(stepIndex(2, 1, 6)).toBe(3);
    expect(stepIndex(2, -1, 6)).toBe(1);
  });

  it('clamps at both ends rather than wrapping', () => {
    expect(stepIndex(0, -1, 6)).toBe(0);
    expect(stepIndex(5, 1, 6)).toBe(5);
  });

  it('survives an empty prototype', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});
