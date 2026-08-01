import { useRef, useState } from 'react';
import type { PatchDocumentInput, SerializedDocument, SerializedTask } from '../../lib/api.js';
import { ShareButton } from '@/components/share/ShareButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '../editor/RichTextEditor.js';
import { SaveStatusIndicator } from '../editor/SaveStatusIndicator.js';
import { useAutosave } from '../editor/useAutosave.js';
import { ContentHistoryButton } from '../history/ContentHistoryPanel.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { DocumentLinks } from './DocumentLinks.js';

export type DocumentEditorMode = 'reader' | 'editor';

type DocumentEditorProps = {
  document: SerializedDocument;
  mode: DocumentEditorMode;
  onSave: (input: PatchDocumentInput) => void | Promise<void>;
  onDelete?: () => void;
  isSaving?: boolean;
  isDeleting?: boolean;
  // Called when the reader highlights text and clicks the floating "Add comment"
  // button — hands the selected passage up to the comment composer.
  onCommentOnSelection?: (passage: string) => void;
  // Inline flow: create a passage-anchored comment from the floating composer.
  onCreateComment?: (input: { passage: string; body: string }) => Promise<void>;
  // Convert selected list-item labels into tasks (editor mode only).
  onConvertListItems?: (labels: string[]) => void | Promise<void>;
  // Enables the "/" slash menu + "[[" document links in the editor.
  projectId?: string;
  docLinks?: { id: string; title: string }[];
};

export function DocumentEditor({
  document,
  mode,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
  onCommentOnSelection,
  onCreateComment,
  onConvertListItems,
  projectId,
  docLinks,
}: DocumentEditorProps) {
  // State is initialized once per mount; the route remounts this via key={docId}
  // when a different document loads, so a save echoing back into props never
  // clobbers in-progress edits.
  const [title, setTitle] = useState(document.title);
  const [statusLine, setStatusLine] = useState(document.status_line ?? '');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Bumped on restore so the rich-text editor remounts with restored body.
  const [bodyEpoch, setBodyEpoch] = useState(0);
  // Latest editor HTML, updated on every keystroke via onChange — survives the
  // child editor unmounting during an exit-flush.
  const bodyRef = useRef(document.body ?? '');

  const applyRestored = (entity: SerializedTask | SerializedDocument) => {
    if (!('title' in entity) || !('body' in entity)) {
      return;
    }
    setTitle(entity.title);
    setStatusLine(entity.status_line ?? '');
    bodyRef.current = entity.body ?? '';
    setBodyEpoch((value) => value + 1);
  };

  const autosave = useAutosave<PatchDocumentInput>({
    buildInput: () => ({
      title,
      body: bodyRef.current,
      status_line: statusLine.trim() === '' ? null : statusLine,
    }),
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
            aria-label="Document title"
            className="h-auto flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight shadow-none focus-visible:border-ring focus-visible:ring-0"
          />
        ) : (
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
        )}
        <div className="flex shrink-0 items-center gap-3 pt-1.5">
          {mode === 'editor' ? <SaveStatusIndicator status={saveStatus} /> : null}
          <ContentHistoryButton
            projectId={document.project_id}
            targetType="document"
            targetId={document.id}
            onRestored={applyRestored}
          />
          <ShareButton resource={{ kind: 'document', id: document.id }} />
          {mode === 'editor' && onDelete !== undefined ? (
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
              autosave.notifyChange();
            }}
            placeholder="Status: draft"
          />
        </div>
      ) : statusLine !== '' ? (
        <p className="text-sm text-muted-foreground">{statusLine}</p>
      ) : null}

      <RichTextEditor
        key={bodyEpoch}
        value={bodyEpoch === 0 ? (document.body ?? '') : bodyRef.current}
        mode={mode}
        onChange={(html) => {
          bodyRef.current = html;
          autosave.notifyChange();
        }}
        onCommentOnSelection={onCommentOnSelection}
        onCreateComment={onCreateComment}
        onConvertListItems={mode === 'editor' ? onConvertListItems : undefined}
        projectId={projectId}
        docLinks={docLinks}
      />

      {projectId !== undefined ? (
        <DocumentLinks
          projectId={projectId}
          document={document}
          editable={mode === 'editor'}
        />
      ) : null}

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
