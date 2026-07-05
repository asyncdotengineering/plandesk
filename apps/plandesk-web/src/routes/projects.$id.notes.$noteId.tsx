import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { CommentsPanel } from '../components/docs/CommentsPanel.js';
import { NoteEditor, type NoteEditorMode } from '../components/notes/NoteEditor.js';
import { useDeleteNote, useNote, usePatchNote, useProject } from '../lib/queries.js';

function NotePage() {
  const { id, noteId } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: note, isLoading: noteLoading, error: noteError } = useNote(noteId);
  const patchNote = usePatchNote();
  const deleteNote = useDeleteNote();
  const [mode, setMode] = useState<NoteEditorMode>('editor');
  const [pendingPassage, setPendingPassage] = useState<string | null>(null);

  if (projectLoading || noteLoading) {
    return <p>Loading note…</p>;
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
    <section>
      <p>
        <Link to="/projects/$id/notes" params={{ id }} style={{ color: '#555' }}>
          ← {project.name} — Notes
        </Link>
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => {
            setMode('reader');
          }}
          aria-pressed={mode === 'reader'}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: mode === 'reader' ? '#e5e7eb' : '#fff',
            fontWeight: mode === 'reader' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Reader
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('editor');
          }}
          aria-pressed={mode === 'editor'}
          style={{
            padding: '0.375rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: mode === 'editor' ? '#e5e7eb' : '#fff',
            fontWeight: mode === 'editor' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Editor
        </button>
      </div>
      {patchNote.error !== null ? (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Save failed: {patchNote.error.message}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <NoteEditor
            note={note}
            mode={mode}
            isSaving={patchNote.isPending}
            isDeleting={deleteNote.isPending}
            onCommentOnSelection={(passage) => {
              setPendingPassage(passage);
            }}
            onSave={(input) => {
              patchNote.mutate({ id: noteId, input });
            }}
            onDelete={() => {
              deleteNote.mutate(
                { id: noteId, projectId: id },
                {
                  onSuccess: () => {
                    void navigate({ to: '/projects/$id/notes', params: { id } });
                  },
                },
              );
            }}
          />
        </div>
        <CommentsPanel
          target={{ type: 'note', id: noteId }}
          attachPassage={pendingPassage}
          onPassageConsumed={() => {
            setPendingPassage(null);
          }}
        />
      </div>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/notes/$noteId')({
  component: NotePage,
});
