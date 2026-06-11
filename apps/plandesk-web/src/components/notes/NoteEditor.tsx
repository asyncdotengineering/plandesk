import Image from '@tiptap/extension-image';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PatchNoteInput, SerializedNote } from '../../lib/api.js';
import { bodyToHtml } from '../../lib/markdown.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import '../docs/document-editor.css';

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

export type NoteEditorMode = 'reader' | 'editor';

type NoteEditorProps = {
  note: SerializedNote;
  mode: NoteEditorMode;
  onSave: (input: PatchNoteInput) => void;
  onDelete?: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
};

export function NoteEditor({
  note,
  mode,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);

  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ allowBase64: true })],
    content: bodyToHtml(note.body ?? ''),
    editable: mode === 'editor',
    editorProps: {
      attributes: {
        class: 'document-editor-content',
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

  useEffect(() => {
    setTitle(note.title);
  }, [note.title]);

  useEffect(() => {
    editor.setEditable(mode === 'editor');
  }, [editor, mode]);

  useEffect(() => {
    const current = editor.getHTML();
    const next = bodyToHtml(note.body ?? '');
    if (current !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, note.body]);

  const handleSave = () => {
    onSave({ title, body: editor.getHTML() });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        {mode === 'editor' ? (
          <input
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            aria-label="Note title"
            style={{
              flex: 1,
              fontSize: '1.5rem',
              fontWeight: 600,
              border: 'none',
              borderBottom: '1px solid #e5e7eb',
              padding: '0.25rem 0',
            }}
          />
        ) : (
          <h1 style={{ margin: 0, flex: 1 }}>{title}</h1>
        )}
        {mode === 'editor' ? (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || title.trim() === ''}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 6,
                border: '1px solid #1d4ed8',
                background: '#1d4ed8',
                color: '#fff',
                fontWeight: 600,
                cursor: isSaving ? 'wait' : 'pointer',
              }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            {onDelete !== undefined ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this note?')) {
                    onDelete();
                  }
                }}
                disabled={isDeleting}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 6,
                  border: '1px solid #fca5a5',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  fontWeight: 600,
                  cursor: isDeleting ? 'wait' : 'pointer',
                }}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {mode === 'editor' ? <NoteToolbar editor={editor} /> : null}

      {mode === 'reader' ? (
        <div
          className="document-reader-content"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyToHtml(note.body ?? '')) }}
          style={{
            lineHeight: 1.6,
            padding: '1rem',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            minHeight: '12rem',
          }}
        />
      ) : (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            minHeight: '12rem',
          }}
        >
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}

type ToolbarEditor = NonNullable<ReturnType<typeof useEditor>>;

function NoteToolbar({ editor }: { editor: ToolbarEditor }) {
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
