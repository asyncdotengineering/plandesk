import { useEffect, useRef, useState } from 'react';
import type { PatchDocumentInput, SerializedDocument } from '../../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor, type RichTextEditorHandle } from '../editor/RichTextEditor.js';
import { ConfirmDialog } from './ConfirmDialog.js';

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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    setTitle(document.title);
    setStatusLine(document.status_line ?? '');
  }, [document.title, document.status_line]);

  const handleSave = () => {
    onSave({
      title,
      body: editorRef.current?.getHTML() ?? '',
      status_line: statusLine.trim() === '' ? null : statusLine,
    });
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
            aria-label="Document title"
            className="h-auto flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight shadow-none focus-visible:border-ring focus-visible:ring-0"
          />
        ) : (
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
        )}
        {mode === 'editor' ? (
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <Button type="button" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
            {onDelete !== undefined ? (
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                aria-label="Delete document"
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

      {mode === 'editor' ? (
        <div className="space-y-1.5">
          <Label htmlFor="document-status-line" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Input
            id="document-status-line"
            type="text"
            value={statusLine}
            onChange={(event) => {
              setStatusLine(event.target.value);
            }}
            placeholder="Status: draft"
          />
        </div>
      ) : statusLine !== '' ? (
        <p className="text-sm text-muted-foreground">{statusLine}</p>
      ) : null}

      <RichTextEditor
        ref={editorRef}
        value={document.body ?? ''}
        mode={mode}
        onCommentOnSelection={onCommentOnSelection}
      />

      {onDelete !== undefined ? (
        <ConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title="Delete this document?"
          description="This document and its comments will be deleted. This cannot be undone."
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
