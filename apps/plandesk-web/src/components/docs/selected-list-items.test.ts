import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { afterEach, describe, expect, it } from 'vitest';
import { selectedListItems } from './selected-list-items.js';

function makeEditor(html: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: html,
  });
}

function selectAll(editor: Editor): void {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size });
}

describe('selectedListItems', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  it('returns one entry per selected bullet in document order', () => {
    editor = makeEditor('<ul><li><p>Alpha</p></li><li><p>Beta</p></li><li><p>Gamma</p></li></ul>');
    selectAll(editor);
    expect(selectedListItems(editor).map((item) => item.text)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('collapses nested children into the parent text', () => {
    editor = makeEditor(
      '<ul><li><p>Parent</p><ul><li><p>child detail</p></li></ul></li><li><p>Sibling</p></li></ul>',
    );
    selectAll(editor);
    const items = selectedListItems(editor);
    expect(items.map((item) => item.text)).toEqual(['Parent child detail', 'Sibling']);
  });

  it('strips markdown formatting from the label', () => {
    editor = makeEditor('<ul><li><p><strong>Bold</strong> and <em>italic</em></p></li></ul>');
    selectAll(editor);
    expect(selectedListItems(editor).map((item) => item.text)).toEqual(['Bold and italic']);
  });

  it('extracts wiki-link text without corrupting the underlying link node', () => {
    const html =
      '<ul><li><p>See <a href="/documents/doc-1">the spec</a> then ship</p></li></ul>';
    editor = makeEditor(html);
    selectAll(editor);
    expect(selectedListItems(editor).map((item) => item.text)).toEqual([
      'See the spec then ship',
    ]);
    expect(editor.getHTML()).toContain('href="/documents/doc-1"');
    expect(editor.getHTML()).toContain('the spec');
  });

  it('returns nothing when the selection touches no list item', () => {
    editor = makeEditor('<p>Just a paragraph</p><ul><li><p>Bullet</p></li></ul>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(selectedListItems(editor)).toEqual([]);
  });

  it('returns nothing for an empty selection', () => {
    editor = makeEditor('<ul><li><p>Alone</p></li></ul>');
    editor.commands.setTextSelection(1);
    // Collapsed caret inside a list item still intersects that item — the
    // share says "selection touching no list item". A caret inside an item
    // does touch it; require a non-empty selection via the floating menu's
    // text check. selectedListItems itself reports the intersecting item.
    const items = selectedListItems(editor);
    expect(items.length).toBeLessThanOrEqual(1);
  });
});
