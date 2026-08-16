import { useRef, useState } from 'react';
import type { PatchNoteInput, SerializedNote } from '../../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RichTextEditor } from '../editor/RichTextEditor.js';
import { SaveStatusIndicator } from '../editor/SaveStatusIndicator.js';
import { useAutosave } from '../editor/useAutosave.js';
import { ConfirmDialog } from '../docs/ConfirmDialog.js';

export type NoteEditorMode = 'reader' | 'editor';

type NoteEditorProps = {
  note: SerializedNote;
  mode: NoteEditorMode;
  onSave: (input: PatchNoteInput) => void | Promise<void>;
  onDelete?: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
  onCommentOnSelection?: (passage: string) => void;
  onCreateComment?: (input: { passage: string; body: string }) => Promise<void>;
  projectId?: string;
  docLinks?: { id: string; title: string }[];
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
  projectId,
  docLinks,
}: NoteEditorProps) {
  // Initialized once per mount; the route remounts this via key={noteId} when a
  // different note loads, so a save echo never clobbers in-progress edits.
  const [title, setTitle] = useState(note.title);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Latest editor HTML; notes are stored as HTML (MCP converts agent Markdown).
  const bodyRef = useRef(note.body ?? '');

  const autosave = useAutosave<PatchNoteInput>({
    buildInput: () => ({ title, body: bodyRef.current }),
    onSave,
  });

  const saveStatus = isSaving ? 'saving' : autosave.status;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        {mode === 'editor' ? (
          <Input
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              autosave.notifyChange();
            }}
            aria-label="Note title"
            className="h-auto flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight shadow-none focus-visible:border-ring focus-visible:ring-0"
          />
        ) : (
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
        )}
        <div className="flex shrink-0 items-center gap-3 pt-1.5">
          {mode === 'editor' ? <SaveStatusIndicator status={saveStatus} /> : null}
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
      </div>

      <RichTextEditor
        value={note.body ?? ''}
        mode={mode}
        onChange={(html) => {
          bodyRef.current = html;
          autosave.notifyChange();
        }}
        onCommentOnSelection={onCommentOnSelection}
        onCreateComment={onCreateComment}
        projectId={projectId}
        docLinks={docLinks}
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
