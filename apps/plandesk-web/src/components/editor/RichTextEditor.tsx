import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { bodyToHtml } from '../../lib/markdown.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import '../docs/document-editor.css';

// Bodies stored as HTML round-trip through getHTML(). Task descriptions are
// markdown the MCP reads/writes, so those save paths call getMarkdown() — HTML
// back to GFM markdown (tables/strikethrough/task-lists via the gfm plugin).
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});
turndownService.use(gfm);

// TipTap serializes tables with a <colgroup> and wraps every cell in a <p>.
// Both defeat turndown-plugin-gfm's GFM-table detection (it needs <tbody> as the
// table's first child and inline cell content), so tables would otherwise fall
// back to raw HTML. Normalize the markup so tables round-trip to GFM Markdown.
function normalizeForMarkdown(html: string): string {
  const template = window.document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('colgroup').forEach((el) => {
    el.remove();
  });
  template.content.querySelectorAll('th, td').forEach((cell) => {
    Array.from(cell.children).forEach((child) => {
      if (child.tagName === 'P') {
        child.replaceWith(...Array.from(child.childNodes));
      }
    });
  });
  return template.innerHTML;
}

function insertImageFiles(view: EditorView, files: FileList | null | undefined, pos?: number) {
  const imageType = view.state.schema.nodes.image;
  if (imageType === undefined) {
    return false;
  }
  const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
  for (const file of images) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        return;
      }
      const node = imageType.create({ src: reader.result, alt: file.name });
      const tr =
        pos === undefined
          ? view.state.tr.replaceSelectionWith(node)
          : view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node);
      view.dispatch(tr);
    };
    reader.readAsDataURL(file);
  }
  return images.length > 0;
}

export type RichTextEditorMode = 'reader' | 'editor';

// Imperative handle so each surface pulls content in its own storage format on
// save: getHTML() for documents/notes (stored as HTML), getMarkdown() for task
// descriptions (stored as markdown the MCP parses).
export type RichTextEditorHandle = {
  getHTML: () => string;
  getMarkdown: () => string;
  // True only after the user has edited the content since it was last loaded.
  // Lets a caller skip a lossy Markdown re-serialization when nothing changed.
  isDirty: () => boolean;
};

type RichTextEditorProps = {
  value: string;
  mode: RichTextEditorMode;
  minHeight?: string;
  ariaLabel?: string;
  // When provided (documents today), highlighting text surfaces a floating
  // "Add comment" button that hands the selected passage up to a composer.
  onCommentOnSelection?: (passage: string) => void;
};

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    { value, mode, minHeight = '12rem', ariaLabel, onCommentOnSelection },
    ref,
  ) {
    const contentRef = useRef<HTMLDivElement>(null);
    // Tracks real user edits; reset whenever a new `value` is loaded.
    const dirtyRef = useRef(false);
    const [selectionMenu, setSelectionMenu] = useState<{
      top: number;
      left: number;
      text: string;
    } | null>(null);

    const editor = useEditor({
      extensions: [StarterKit, Image.configure({ allowBase64: true }), TableKit],
      content: bodyToHtml(value),
      editable: mode === 'editor',
      onUpdate: () => {
        dirtyRef.current = true;
      },
      editorProps: {
        attributes: {
          class: 'document-editor-content',
          ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
        },
        handlePaste: (view, event) => insertImageFiles(view, event.clipboardData?.files),
        handleDrop: (view, event, _slice, moved) => {
          if (moved) {
            return false;
          }
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          return insertImageFiles(view, event.dataTransfer?.files, pos);
        },
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        getHTML: () => editor.getHTML(),
        getMarkdown: () => turndownService.turndown(normalizeForMarkdown(editor.getHTML())),
        isDirty: () => dirtyRef.current,
      }),
      [editor],
    );

    useEffect(() => {
      editor.setEditable(mode === 'editor');
    }, [editor, mode]);

    useEffect(() => {
      // A freshly loaded value is not a user edit.
      dirtyRef.current = false;
      const current = editor.getHTML();
      const next = bodyToHtml(value);
      if (current !== next) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
    }, [editor, value]);

    // DOM-selection based so it works in both reader and editor mode; `window`
    // avoids the `document` global shadow. Best-effort positioning
    // (getBoundingClientRect can throw on a detached range under jsdom).
    useEffect(() => {
      if (onCommentOnSelection === undefined) {
        return;
      }
      const container = contentRef.current;
      if (container === null) {
        return;
      }
      const showForSelection = () => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? '';
        if (selection === null || selection.rangeCount === 0 || text === '') {
          setSelectionMenu(null);
          return;
        }
        const anchor = selection.anchorNode;
        if (anchor !== null && !container.contains(anchor)) {
          setSelectionMenu(null);
          return;
        }
        let top = 0;
        let left = 0;
        try {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          top = rect.top;
          left = rect.left + rect.width / 2;
        } catch {
          // detached range
        }
        setSelectionMenu({ top, left, text });
      };
      const clearSelection = () => {
        setSelectionMenu(null);
      };
      container.addEventListener('mouseup', showForSelection);
      container.addEventListener('mousedown', clearSelection);
      return () => {
        container.removeEventListener('mouseup', showForSelection);
        container.removeEventListener('mousedown', clearSelection);
      };
    }, [onCommentOnSelection]);

    return (
      <div>
        {mode === 'editor' ? <RichTextToolbar editor={editor} /> : null}

        <div ref={contentRef}>
          {mode === 'reader' ? (
            <div
              className="document-reader-content"
              aria-label={ariaLabel}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyToHtml(value)) }}
              style={{
                lineHeight: 1.6,
                padding: '1rem',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                minHeight,
              }}
            />
          ) : (
            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '0.75rem 1rem',
                minHeight,
              }}
            >
              <EditorContent editor={editor} />
            </div>
          )}
        </div>

        {onCommentOnSelection !== undefined && selectionMenu !== null ? (
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onCommentOnSelection(selectionMenu.text);
              setSelectionMenu(null);
              window.getSelection()?.removeAllRanges();
            }}
            style={{
              position: 'fixed',
              top: Math.max(selectionMenu.top - 42, 8),
              left: selectionMenu.left,
              transform: 'translateX(-50%)',
              zIndex: 50,
              padding: '0.375rem 0.625rem',
              borderRadius: 6,
              border: '1px solid #1d4ed8',
              background: '#1d4ed8',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            }}
          >
            💬 Add comment
          </button>
        ) : null}
      </div>
    );
  },
);

type ToolbarEditor = NonNullable<ReturnType<typeof useEditor>>;

function RichTextToolbar({ editor }: { editor: ToolbarEditor }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buttonStyle = (active: boolean): CSSProperties => ({
    padding: '0.25rem 0.5rem',
    borderRadius: 4,
    border: '1px solid #d1d5db',
    background: active ? '#e5e7eb' : '#fff',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  });

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}
    >
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-pressed={editor.isActive('bold')}
        style={buttonStyle(editor.isActive('bold'))}
      >
        Bold
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-pressed={editor.isActive('italic')}
        style={buttonStyle(editor.isActive('italic'))}
      >
        Italic
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-pressed={editor.isActive('heading', { level: 2 })}
        style={buttonStyle(editor.isActive('heading', { level: 2 }))}
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        aria-pressed={editor.isActive('bulletList')}
        style={buttonStyle(editor.isActive('bulletList'))}
      >
        List
      </button>
      <button
        type="button"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        style={buttonStyle(editor.isActive('table'))}
      >
        Table
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        style={buttonStyle(false)}
      >
        Image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Insert image"
        style={{ display: 'none' }}
        onChange={(event) => {
          insertImageFiles(editor.view, event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
