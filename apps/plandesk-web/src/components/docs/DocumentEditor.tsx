import { useEffect, useRef, useState } from 'react';
import type { PatchDocumentInput, SerializedDocument } from '../../lib/api.js';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';

export type DocumentEditorMode = 'reader' | 'editor';

type DocumentEditorProps = {
  document: SerializedDocument;
  mode: DocumentEditorMode;
  onSave: (input: PatchDocumentInput) => void;
  onDelete?: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
  // Called when the reader highlights text and clicks the floating "Add comment"
  // button — hands the selected passage up to the comment composer.
  onCommentOnSelection?: (passage: string) => void;
};

export function DocumentEditor({
  document,
  mode,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
  onCommentOnSelection,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [statusLine, setStatusLine] = useState(document.status_line ?? '');
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    setTitle(document.title);
    setStatusLine(document.status_line ?? '');
  }, [document.title, document.status_line]);

  const handleSave = () => {
    // Documents are stored as HTML — the MCP converts agent Markdown on write.
    onSave({
      title,
      body: editorRef.current?.getHTML() ?? '',
      status_line: statusLine.trim() === '' ? null : statusLine,
    });
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
            aria-label="Document title"
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
              disabled={isSaving}
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
                  if (confirm('Delete this document?')) {
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

      <label
        htmlFor="status-line"
        style={{
          display: 'block',
          fontSize: '0.875rem',
          color: '#6b7280',
          marginBottom: '0.25rem',
        }}
      >
        Status
      </label>
      {mode === 'editor' ? (
        <input
          id="status-line"
          type="text"
          value={statusLine}
          onChange={(event) => {
            setStatusLine(event.target.value);
          }}
          placeholder="Status: draft"
          style={{
            width: '100%',
            marginBottom: '1rem',
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
          }}
        />
      ) : statusLine !== '' ? (
        <p style={{ marginTop: 0, marginBottom: '1rem', color: '#374151' }}>{statusLine}</p>
      ) : null}

      <RichTextEditor
        ref={editorRef}
        value={document.body ?? ''}
        mode={mode}
        onCommentOnSelection={onCommentOnSelection}
      />
    </div>
  );
}
