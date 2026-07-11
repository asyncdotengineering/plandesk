import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { toast } from 'sonner';
import { CommentsPanel } from '../components/docs/CommentsPanel.js';
import { flattenDocumentTree } from '../components/docs/DocumentsPanel.js';
import { NoteEditor, type NoteEditorMode } from '../components/notes/NoteEditor.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCreateComment,
  useDeleteNote,
  useDocuments,
  useNote,
  usePatchNote,
  useProject,
} from '../lib/queries.js';

function NotePage() {
  const { id, noteId } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: note, isLoading: noteLoading, error: noteError } = useNote(noteId);
  const { data: allDocuments } = useDocuments(id);
  const patchNote = usePatchNote();
  const deleteNote = useDeleteNote();
  const createComment = useCreateComment({ type: 'note', id: noteId });
  const [mode, setMode] = useState<NoteEditorMode>('reader');

  const docLinks = flattenDocumentTree(allDocuments ?? []).map((doc) => ({
    id: doc.id,
    title: doc.title,
  }));

  if (projectLoading || noteLoading) {
    return <p className="text-sm text-muted-foreground">Loading note…</p>;
  }

  if (projectError !== null) {
    return <p role="alert">Failed to load project: {projectError.message}</p>;
  }

  if (noteError !== null) {
    return <p role="alert">Failed to load note: {noteError.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  if (note === undefined) {
    return <p>Note not found.</p>;
  }

  if (note.project_id !== id) {
    return <p role="alert">Note does not belong to this project.</p>;
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-0 gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/projects/$id/notes"
            params={{ id }}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Notes
          </Link>
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value as NoteEditorMode);
            }}
          >
            <TabsList>
              <TabsTrigger value="reader">Reader</TabsTrigger>
              <TabsTrigger value="editor">Edit</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {patchNote.error !== null ? (
          <p role="alert" className="text-[13px] text-destructive">
            Save failed: {patchNote.error.message}
          </p>
        ) : null}

        <NoteEditor
          note={note}
          mode={mode}
          projectId={id}
          docLinks={docLinks}
          isSaving={patchNote.isPending}
          isDeleting={deleteNote.isPending}
          onCreateComment={async ({ passage, body }) => {
            await createComment.mutateAsync({ body, passage });
            toast('Comment added');
          }}
          onSave={(input) => {
            patchNote.mutate(
              { id: noteId, input },
              {
                onSuccess: () => {
                  toast('Note saved');
                },
              },
            );
          }}
          onDelete={() => {
            deleteNote.mutate(
              { id: noteId, projectId: id },
              {
                onSuccess: () => {
                  toast('Note deleted');
                  void navigate({ to: '/projects/$id/notes', params: { id } });
                },
              },
            );
          }}
        />
      </div>
      <CommentsPanel target={{ type: 'note', id: noteId }} />
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/notes/$noteId')({
  component: NotePage,
});