/**
 * Per-screen comment anchoring state — frame text from the shim, pending
 * composer drafts from Comment-mode selections. Pattern mirrors
 * `screen-diagnostics.ts` (keyed by artifact id, subscribe/notify).
 */
import type { AnnotationSelector } from '@plandesk/api';

export type FrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PendingAnchorDraft = {
  artifactId: string;
  selector: AnnotationSelector;
  rect: FrameRect;
  /** Passage shown in the composer (quote for text; empty for point). */
  passage: string | null;
};

export type ScreenCommentsStore = {
  getFrameText: (artifactId: string) => string | undefined;
  setFrameText: (artifactId: string, text: string) => void;
  clearFrame: (artifactId: string) => void;
  getPending: () => PendingAnchorDraft | null;
  setPending: (draft: PendingAnchorDraft | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createScreenCommentsStore(): ScreenCommentsStore {
  const frameText = new Map<string, string>();
  let pending: PendingAnchorDraft | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getFrameText(artifactId) {
      return frameText.get(artifactId);
    },
    setFrameText(artifactId, text) {
      frameText.set(artifactId, text);
      notify();
    },
    clearFrame(artifactId) {
      if (!frameText.has(artifactId)) {
        return;
      }
      frameText.delete(artifactId);
      notify();
    },
    getPending() {
      return pending;
    },
    setPending(draft) {
      pending = draft;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function parseFrameReady(data: unknown): { text: string; height?: number } | null {
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const msg = data as { kind?: string; text?: unknown; height?: unknown };
  if (msg.kind !== 'plandesk:ready') {
    return null;
  }
  if (typeof msg.text !== 'string') {
    return null;
  }
  return {
    text: msg.text,
    ...(typeof msg.height === 'number' ? { height: msg.height } : {}),
  };
}

export function parseFrameSelection(data: unknown): {
  selector: AnnotationSelector;
  rect: FrameRect;
} | null {
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const msg = data as { kind?: string; selector?: unknown; rect?: unknown };
  if (msg.kind !== 'plandesk:selection') {
    return null;
  }
  const selector = parseAnnotationSelector(msg.selector);
  const rect = parseFrameRect(msg.rect);
  if (selector === null || rect === null) {
    return null;
  }
  return { selector, rect };
}

export function parseAnnotationSelector(value: unknown): AnnotationSelector | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const s = value as Record<string, unknown>;
  if (s.mode === 'text') {
    if (
      typeof s.quote !== 'string' ||
      typeof s.prefix !== 'string' ||
      typeof s.suffix !== 'string' ||
      typeof s.start !== 'number' ||
      typeof s.end !== 'number' ||
      typeof s.revisionId !== 'string'
    ) {
      return null;
    }
    return {
      mode: 'text',
      quote: s.quote,
      prefix: s.prefix,
      suffix: s.suffix,
      start: s.start,
      end: s.end,
      revisionId: s.revisionId,
    };
  }
  if (s.mode === 'point') {
    if (typeof s.x !== 'number' || typeof s.y !== 'number' || typeof s.revisionId !== 'string') {
      return null;
    }
    return { mode: 'point', x: s.x, y: s.y, revisionId: s.revisionId };
  }
  return null;
}

function parseFrameRect(value: unknown): FrameRect | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (
    typeof r.x !== 'number' ||
    typeof r.y !== 'number' ||
    typeof r.width !== 'number' ||
    typeof r.height !== 'number'
  ) {
    return null;
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function passageFromSelector(selector: AnnotationSelector): string | null {
  if (selector.mode === 'text') {
    return selector.quote.trim() === '' ? null : selector.quote;
  }
  return null;
}
