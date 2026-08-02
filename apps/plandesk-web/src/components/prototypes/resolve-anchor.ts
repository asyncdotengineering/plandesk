/**
 * Resolve a stored AnnotationSelector against frame textContent.
 * Matching runs in the shell; the frame only turns offsets into a rect.
 */
import type { AnnotationSelector } from '@plandesk/api';
import { matchQuote } from './match-quote.js';
import { parseAnnotationSelector } from './screen-comments.js';

export type ResolvedAnchor =
  | { status: 'resolved'; start: number; end: number; score: number; stale: boolean }
  | { status: 'point'; x: number; y: number; stale: boolean }
  | { status: 'orphan'; stale: boolean }
  /** Frame text not yet reported — do not render as orphan. */
  | { status: 'pending'; stale: boolean };

/**
 * Parse `comments.anchor` JSON. Invalid / unknown shapes → null (caller treats
 * as unanchored body comment, not an orphan pin).
 */
export function parseStoredAnchor(anchor: string | null | undefined): AnnotationSelector | null {
  if (anchor === null || anchor === undefined || anchor.trim() === '') {
    return null;
  }
  try {
    return parseAnnotationSelector(JSON.parse(anchor) as unknown);
  } catch {
    return null;
  }
}

export function resolveAnchor(
  frameText: string | undefined,
  selector: AnnotationSelector,
  currentRevisionId: string,
): ResolvedAnchor {
  const stale = selector.revisionId !== currentRevisionId;

  if (selector.mode === 'point') {
    return { status: 'point', x: selector.x, y: selector.y, stale };
  }

  if (frameText === undefined) {
    return { status: 'pending', stale };
  }

  const match = matchQuote(frameText, selector.quote, {
    prefix: selector.prefix,
    suffix: selector.suffix,
    hint: selector.start,
  });

  if (match === null) {
    return { status: 'orphan', stale };
  }

  return {
    status: 'resolved',
    start: match.start,
    end: match.end,
    score: match.score,
    stale,
  };
}
