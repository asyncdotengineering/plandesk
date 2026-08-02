import { describe, expect, it } from 'vitest';
import { edgeLabels, linkEntityTypes } from './schema.js';
import { linkEntityTypes as vocabularyLinkEntityTypes } from './vocabulary.js';
import { toLinkEntityType } from './portability-import.js';

describe('linkEntityTypes vocabulary', () => {
  it('includes artifact and prototype for authored links', () => {
    expect(linkEntityTypes).toEqual(['task', 'document', 'artifact', 'prototype']);
  });

  it('is the same binding schema re-exports from vocabulary', () => {
    expect(linkEntityTypes).toBe(vocabularyLinkEntityTypes);
  });

  it('does not add navigates_to to edgeLabels', () => {
    expect((edgeLabels as readonly string[]).includes('navigates_to')).toBe(false);
  });

  it('toLinkEntityType accepts the widened union and rejects unknowns', () => {
    expect(toLinkEntityType('task')).toBe('task');
    expect(toLinkEntityType('document')).toBe('document');
    expect(toLinkEntityType('artifact')).toBe('artifact');
    expect(toLinkEntityType('prototype')).toBe('prototype');
    expect(toLinkEntityType('navigates_to')).toBeNull();
    expect(toLinkEntityType('note')).toBeNull();
  });
});
