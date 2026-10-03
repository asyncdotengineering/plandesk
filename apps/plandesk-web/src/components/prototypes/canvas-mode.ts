import { canvasModes, type CanvasMode } from '@plandesk/api';

export type { CanvasMode };

export const CANVAS_MODES = canvasModes;

/** Arrange is the default so screen bodies are layoutable (frames eat events otherwise). */
export const DEFAULT_CANVAS_MODE: CanvasMode = 'arrange';

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
