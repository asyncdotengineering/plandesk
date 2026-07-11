import { useEffect, useRef, useState } from 'react';
import type { PatchNoteInput, SerializedNote } from '../../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';
import { ConfirmDialog } from '../docs/ConfirmDialog.js';

export type NoteEditorMode = 'reader' | 'editor';

type NoteEditorProps = {
  note: SerializedNote;
  mode: NoteEditorMode;
  onSave: (input: PatchNoteInput) => void;
  onDelete?: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
  onCommentOnSelection?: (passage: string) => void;
  onCreateComment?: (input: { passage: string; body: string }) => Promise<void>;
};

export function NoteEditor({
  note,
  mode,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
  onCommentOnSelection,
  onCreateComment,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    setTitle(note.title);
  }, [note.title]);

  const handleSave = () => {
    // Notes are stored as HTML — the MCP converts agent Markdown on write.
    onSave({ title, body: editorRef.current?.getHTML() ?? '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        {mode === 'editor' ? (
          <Input
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            aria-label="Note title"
            className="h-auto flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight shadow-none focus-visible:border-ring focus-visible:ring-0"
          />
        ) : (
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
        )}
        {mode === 'editor' ? (
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <Button type="button" onClick={handleSave} disabled={isSaving || title.trim() === ''}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
            {onDelete !== undefined ? (
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                aria-label="Delete note"
                onClick={() => {
                  setConfirmDeleteOpen(true);
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <RichTextEditor
        ref={editorRef}
        value={note.body ?? ''}
        mode={mode}
        onCommentOnSelection={onCommentOnSelection}
        onCreateComment={onCreateComment}
      />

      {onDelete !== undefined ? (
        <ConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title="Delete this note?"
          description="This note and its comments will be deleted. This cannot be undone."
          busy={isDeleting}
          onConfirm={() => {
            setConfirmDeleteOpen(false);
            onDelete();
          }}
        />
      ) : null}
    </div>
  );
}