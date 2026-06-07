import { Link, createFileRoute } from '@tanstack/react-router';
import { Board } from '../components/board/Board.js';
import { useProject, useTasks } from '../lib/queries.js';
import { validateTaskFilterSearch } from '../lib/search.js';

function ProjectBoardPage() {
  const { id } = Route.useParams();
  const { status } = Route.useSearch();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useTasks(id, status !== undefined ? { status } : {});

  if (projectLoading || tasksLoading) {
    return <p>Loading board…</p>;
  }

  if (projectError !== null) {
    return <p role="alert">Failed to load project: {projectError.message}</p>;
  }

  if (tasksError !== null) {
    return <p role="alert">Failed to load tasks: {tasksError.message}</p>;
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <section>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <Link to="/projects/$id/overview" params={{ id }} style={{ color: '#555' }}>
          Overview
        </Link>
        <Link to="/projects/$id/flow" params={{ id }} style={{ color: '#555' }}>
          Flow
        </Link>
        <Link
          to="/projects/$id/board"
          params={{ id }}
          style={{ fontWeight: 600, color: '#1a56db' }}
        >
          Board
        </Link>
      </nav>
      <h1 style={{ marginTop: 0 }}>{project.name} — Board</h1>
      {status !== undefined ? (
        <p style={{ color: '#666', marginTop: 0 }}>Filter: {status}</p>
      ) : null}
      <Board projectId={id} tasks={tasks ?? []} />
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/board')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectBoardPage,
});
