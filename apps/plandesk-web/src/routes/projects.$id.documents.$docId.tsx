import { Link, createFileRoute } from '@tanstack/react-router';
import { useProject } from '../lib/queries.js';

function DocumentPage() {
  const { id, docId } = Route.useParams();
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
      <p>
        <Link to="/projects/$id/overview" params={{ id: id }} style={{ color: '#555' }}>
          ← {project.name}
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Document</h1>
      <p style={{ color: '#666' }}>
        Editor for document <code>{docId}</code> (S3-03).
      </p>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/documents/$docId')({
  component: DocumentPage,
});
