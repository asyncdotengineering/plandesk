import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCreateNote, useNotes, useProject } from '../lib/queries.js';

function ProjectNotesNav({ projectId }: { projectId: string }) {
  return (
    <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
      <Link to="/projects/$id/overview" params={{ id: projectId }} style={{ color: '#555' }}>
        Overview
      </Link>
      <Link to="/projects/$id/flow" params={{ id: projectId }} style={{ color: '#555' }}>
        Flow
      </Link>
      <Link to="/projects/$id/board" params={{ id: projectId }} style={{ color: '#555' }}>
        Board
      </Link>
      <Link
        to="/projects/$id/notes"
        params={{ id: projectId }}
        style={{ fontWeight: 600, color: '#1a56db' }}
      >
        Notes
      </Link>
      <Link to="/projects/$id/inbox" params={{ id: projectId }} style={{ color: '#555' }}>
        Inbox
      </Link>
    </nav>
  );
}

function ProjectNotesPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: notes, isLoading: notesLoading, error: notesError } = useNotes(id);
  const createNote = useCreateNote(id);

  const handleNewNote = () => {
    const title = prompt('Note title');
    if (title === null) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed === '') {
      return;
    }
    createNote.mutate(
      { title: trimmed },
      {
        onSuccess: (note) => {
          void navigate({
            to: '/projects/$id/notes/$noteId',
            params: { id, noteId: note.id },
          });
        },
      },
    );
  };

  if (projectLoading || notesLoading) {
    return <p>Loading notes…</p>;
  }

  if (projectError !== null) {
    return <p role="alert">Failed to load project: {projectError.message}</p>;
  }

  if (notesError !== null) {
    return <p role="alert">Failed to load notes: {notesError.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <section>
      <ProjectNotesNav projectId={id} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, flex: 1 }}>{project.name} — Notes</h1>
        <button
          type="button"
          onClick={handleNewNote}
          disabled={createNote.isPending}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 6,
            border: '1px solid #1d4ed8',
            background: '#1d4ed8',
            color: '#fff',
            fontWeight: 600,
            cursor: createNote.isPending ? 'wait' : 'pointer',
          }}
        >
          {createNote.isPending ? 'Creating…' : 'New note'}
        </button>
      </div>
      {createNote.error !== null ? (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Failed to create note: {createNote.error.message}
        </p>
      ) : null}

      {notes !== undefined && notes.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {notes.map((note) => (
            <li key={note.id} style={{ padding: '0.375rem 0' }}>
              <Link
                to="/projects/$id/notes/$noteId"
                params={{ id, noteId: note.id }}
                style={{ color: '#1a56db', textDecoration: 'none' }}
              >
                {note.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: '#6b7280' }}>No notes yet. Create one to capture working notes.</p>
      )}
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/notes/')({
  component: ProjectNotesPage,
});
