import { Link, createFileRoute } from '@tanstack/react-router';
import { useProject } from '../lib/queries.js';
import { validateTaskFilterSearch } from '../lib/search.js';

function ProjectFlowPage() {
  const { id } = Route.useParams();
  const { status } = Route.useSearch();
  const { data: project, isLoading, error } = useProject(id);

  if (isLoading) {
    return <p>Loading project…</p>;
  }

  if (error) {
    return <p role="alert">Failed to load project: {error.message}</p>;
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
        <Link to="/projects/$id/flow" params={{ id }} style={{ fontWeight: 600, color: '#1a56db' }}>
          Flow
        </Link>
        <Link to="/projects/$id/board" params={{ id }} style={{ color: '#555' }}>
          Board
        </Link>
      </nav>
      <h1 style={{ marginTop: 0 }}>{project.name} — Flow</h1>
      <p style={{ color: '#666' }}>
        Canvas view (S3-02).{status !== undefined ? ` Filter: ${status}` : ''}
      </p>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/flow')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectFlowPage,
});
