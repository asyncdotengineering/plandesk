import { describe, expect, it } from 'vitest';
import { isCanvasPath } from './__root.js';

// A prototype canvas rendered inside the app shell kept a 244px sidebar, a 48px
// breadcrumb topbar and 24px of content padding — none of which steers a canvas.
// This predicate is what takes the route out of the shell, so a miss here
// silently restores the cramped layout rather than failing loudly.
describe('isCanvasPath', () => {
  it('claims the authoring canvas', () => {
    expect(isCanvasPath('/projects/proj-1/prototypes/proto-9')).toBe(true);
  });

  it('claims the shared canvas in the client portal', () => {
    expect(isCanvasPath('/p/share-token/prototypes/proto-9')).toBe(true);
  });

  it('claims preview mode, which is a whole-window surface too', () => {
    expect(isCanvasPath('/projects/proj-1/prototypes/proto-9/present/screen-3')).toBe(true);
    expect(isCanvasPath('/p/share-token/prototypes/proto-9/present/screen-3')).toBe(true);
  });

  it('leaves the prototype list inside the shell', () => {
    expect(isCanvasPath('/projects/proj-1/prototypes')).toBe(false);
    expect(isCanvasPath('/p/share-token/prototypes')).toBe(false);
  });

  it('leaves other detail routes inside the shell', () => {
    expect(isCanvasPath('/projects/proj-1/documents/doc-9')).toBe(false);
    expect(isCanvasPath('/projects/proj-1/notes/note-9')).toBe(false);
    expect(isCanvasPath('/projects/proj-1/board')).toBe(false);
  });

  it('ignores a trailing slash rather than dropping out of the shell', () => {
    expect(isCanvasPath('/projects/proj-1/prototypes/proto-9/')).toBe(true);
  });
});
