/**
 * The factor that fits a screen's declared viewport inside the space available
 * to it, never magnifying past 1.
 *
 * A prototype declares one viewport for every screen it holds, and that
 * viewport routinely exceeds the window it is reviewed in — a 1440×900 desktop
 * flow opened on a laptop, a share link opened on a smaller display. Cropping
 * hides exactly the part a reviewer was sent to look at, so the screen shrinks
 * instead. Growing past 1 is the opposite mistake: an upscaled screen is no
 * longer the design under review.
 */
export function fitScale(
  available: { width: number; height: number },
  viewport: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  if (available.width <= 0 || available.height <= 0) {
    return 1;
  }
  return Math.min(1, available.width / viewport.width, available.height / viewport.height);
}

/** Index of the next screen when stepping by `delta`, clamped to the ends. */
export function stepIndex(current: number, delta: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(total - 1, Math.max(0, current + delta));
}
