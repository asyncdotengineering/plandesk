import { describe, expect, it } from 'vitest';
import { detailFromPath } from './__root.js';

// The breadcrumb used to stop at the view segment, so a document page read
// "Workspace › Project › Documents" — naming the list you had navigated away
// from, with the open document appearing nowhere. The detail pages compensated
// with a lone back arrow, which discards everything above it.
describe('detailFromPath', () => {
  it('names the open document so the trail can reach it', () => {
    expect(detailFromPath('/projects/proj-1/documents/doc-9')).toEqual({
      kind: 'documents',
      recordId: 'doc-9',
    });
  });

  it('names the open note', () => {
    expect(detailFromPath('/projects/proj-1/notes/note-3')).toEqual({
      kind: 'notes',
      recordId: 'note-3',
    });
  });

  it('returns null on the list itself, so the view stays the leaf', () => {
    expect(detailFromPath('/projects/proj-1/documents')).toBeNull();
    expect(detailFromPath('/projects/proj-1/documents/')).toBeNull();
    expect(detailFromPath('/projects/proj-1/notes')).toBeNull();
  });

  it('ignores views that have no detail page', () => {
    // A board or flow route with a trailing segment must not grow a crumb that
    // would then query a document id that does not exist.
    expect(detailFromPath('/projects/proj-1/board/anything')).toBeNull();
    expect(detailFromPath('/projects/proj-1/flow/x')).toBeNull();
    expect(detailFromPath('/projects/proj-1/goals/g-1')).toBeNull();
  });

  it('ignores non-project routes', () => {
    expect(detailFromPath('/settings/mcp')).toBeNull();
    expect(detailFromPath('/')).toBeNull();
    expect(detailFromPath('/p/share-token/documents/doc-1')).toBeNull();
  });
});
