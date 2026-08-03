import { describe, expect, it } from 'vitest';
import { FOLDER_REPARENT_CYCLE_MESSAGE, wouldCreateFolderReparentCycle } from './folder-cycle.js';

describe('wouldCreateFolderReparentCycle', () => {
  const parentOf = (id: string): string | null => {
    const parents: Record<string, string | null> = {
      f1: null,
      f2: 'f1',
      f3: 'f2',
    };
    return parents[id] ?? null;
  };

  it('detects a cycle when the new parent is a descendant', () => {
    expect(wouldCreateFolderReparentCycle('f1', 'f3', parentOf)).toBe(true);
    expect(wouldCreateFolderReparentCycle('f1', 'f2', parentOf)).toBe(true);
  });

  it('allows legal re-parents', () => {
    expect(wouldCreateFolderReparentCycle('f3', 'f1', parentOf)).toBe(false);
    expect(wouldCreateFolderReparentCycle('f2', 'f1', parentOf)).toBe(false);
  });

  it('exports the server rejection message', () => {
    expect(FOLDER_REPARENT_CYCLE_MESSAGE).toMatch(/cycle/i);
  });
});
