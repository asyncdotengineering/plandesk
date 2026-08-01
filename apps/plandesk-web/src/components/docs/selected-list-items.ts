import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export type SelectedListItem = {
  text: string;
  pos: number;
};

/**
 * One entry per outermost list item intersecting the editor selection.
 * Nested children collapse into the parent's textContent (sub-bullets are
 * detail about the parent, not sibling deliverables). Formatting and wiki-link
 * markup are stripped via textContent — the label is plain text.
 */
export function selectedListItems(editor: Editor): SelectedListItem[] {
  const { from, to } = editor.state.selection;
  const hits: SelectedListItem[] = [];

  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== 'listItem' && node.type.name !== 'taskItem') {
      return true;
    }
    const nodeFrom = pos;
    const nodeTo = pos + node.nodeSize;
    if (nodeTo <= from || nodeFrom >= to) {
      return true;
    }
    // Skip nested items whose ancestor listItem/taskItem already intersects —
    // their text folds into the parent's textContent.
    if (
      hits.some(
        (hit) => nodeFrom >= hit.pos && nodeTo <= hit.pos + ancestorSize(editor, hit.pos),
      )
    ) {
      return false;
    }
    const text = listItemPlainText(node);
    if (text !== '') {
      hits.push({ text, pos: nodeFrom });
    }
    return false;
  });

  return hits.sort((a, b) => a.pos - b.pos);
}

/** Plain label text: strip marks/links, put a space between adjacent blocks. */
function listItemPlainText(node: ProseMirrorNode): string {
  const parts: string[] = [];
  node.descendants((child) => {
    if (child.isText && child.text !== undefined && child.text !== '') {
      parts.push(child.text);
    }
    return true;
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function ancestorSize(editor: Editor, pos: number): number {
  const node = editor.state.doc.nodeAt(pos);
  return node?.nodeSize ?? 0;
}
