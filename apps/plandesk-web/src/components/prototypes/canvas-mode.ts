/** Shell-owned canvas gesture mode. Mirrors the shim's CanvasMode union. */
export type CanvasMode = 'arrange' | 'interact' | 'comment';

export const CANVAS_MODES: readonly CanvasMode[] = ['arrange', 'interact', 'comment'] as const;

/** Arrange is the default so screen bodies are layoutable (frames eat events otherwise). */
export const DEFAULT_CANVAS_MODE: CanvasMode = 'arrange';

export function isCanvasMode(value: unknown): value is CanvasMode {
  return value === 'arrange' || value === 'interact' || value === 'comment';
}

export function modeLabel(mode: CanvasMode): string {
  switch (mode) {
    case 'arrange':
      return 'Arrange';
    case 'interact':
      return 'Interact';
    case 'comment':
      return 'Comment';
  }
}
