import { useEffect, useRef, useState } from 'react';
import type { PatchNoteInput, SerializedNote } from '../../lib/api.js';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';

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
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    setTitle(note.title);
  }, [note.title]);

  const handleSave = () => {
    // Notes are stored as HTML — the MCP converts agent Markdown on write.
    onSave({ title, body: editorRef.current?.getHTML() ?? '' });
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

      <RichTextEditor ref={editorRef} value={note.body ?? ''} mode={mode} />
    </div>
  );
}
