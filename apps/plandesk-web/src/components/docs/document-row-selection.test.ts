import { describe, expect, it } from 'vitest';
import { applyDocumentSelectionClick } from './document-row-selection.js';

const ordered = ['a', 'b', 'c', 'd', 'e'];

describe('applyDocumentSelectionClick', () => {
  it('toggles a single id on plain click', () => {
    const first = applyDocumentSelectionClick({
      selected: new Set(),
      anchorId: null,
      orderedIds: ordered,
      clickedId: 'b',
      shiftKey: false,
    });
    expect([...first.selected]).toEqual(['b']);
    expect(first.anchorId).toBe('b');

    const second = applyDocumentSelectionClick({
      selected: first.selected,
      anchorId: first.anchorId,
      orderedIds: ordered,
      clickedId: 'b',
      shiftKey: false,
    });
    expect([...second.selected]).toEqual([]);
  });

  it('shift-click selects the inclusive range from the anchor', () => {
    const anchored = applyDocumentSelectionClick({
      selected: new Set(),
      anchorId: null,
      orderedIds: ordered,
      clickedId: 'b',
      shiftKey: false,
    });
    const ranged = applyDocumentSelectionClick({
      selected: anchored.selected,
      anchorId: anchored.anchorId,
      orderedIds: ordered,
      clickedId: 'd',
      shiftKey: true,
    });
    expect([...ranged.selected].sort()).toEqual(['b', 'c', 'd']);
    expect(ranged.anchorId).toBe('b');
  });

  it('shift-click without an anchor falls back to toggling the clicked id', () => {
    const result = applyDocumentSelectionClick({
      selected: new Set(),
      anchorId: null,
      orderedIds: ordered,
      clickedId: 'c',
      shiftKey: true,
    });
    expect([...result.selected]).toEqual(['c']);
    expect(result.anchorId).toBe('c');
  });
});
