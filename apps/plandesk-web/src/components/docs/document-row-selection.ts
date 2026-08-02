/**
 * Ordered multi-select for document rows (checkbox + shift-click range).
 * Sibling to selected-list-items.ts, which extracts TipTap list labels — not row ids.
 */

export type SelectionClick = {
  /** Currently selected document ids. */
  selected: ReadonlySet<string>;
  /** Anchor for the next shift-click range. */
  anchorId: string | null;
  /** Document ids in visible tree order (used for range bounds). */
  orderedIds: readonly string[];
  /** Id the user activated. */
  clickedId: string;
  /** Shift key held — select contiguous range from anchor. */
  shiftKey: boolean;
};

export type SelectionClickResult = {
  selected: Set<string>;
  anchorId: string;
};

/**
 * Apply a checkbox / row click to the selection set.
 * - Plain click toggles the clicked id and sets the anchor.
 * - Shift-click selects the inclusive range from anchor → clicked (or just the
 *   clicked id when there is no anchor yet).
 */
export function applyDocumentSelectionClick(input: SelectionClick): SelectionClickResult {
  const { orderedIds, clickedId, shiftKey } = input;
  if (shiftKey && input.anchorId !== null) {
    const from = orderedIds.indexOf(input.anchorId);
    const to = orderedIds.indexOf(clickedId);
    if (from === -1 || to === -1) {
      return { selected: new Set([clickedId]), anchorId: clickedId };
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    const next = new Set(input.selected);
    for (let i = start; i <= end; i += 1) {
      const id = orderedIds[i];
      if (id !== undefined) {
        next.add(id);
      }
    }
    return { selected: next, anchorId: input.anchorId };
  }

  const next = new Set(input.selected);
  if (next.has(clickedId)) {
    next.delete(clickedId);
  } else {
    next.add(clickedId);
  }
  return { selected: next, anchorId: clickedId };
}
