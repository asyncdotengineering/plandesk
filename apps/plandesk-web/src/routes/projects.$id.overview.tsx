import { Link, createFileRoute } from '@tanstack/react-router';
import { taskStatuses } from '../lib/api.js';
import { useProject } from '../lib/queries.js';

function ProjectNav({ projectId }: { projectId: string }) {
  const tabs = [
    { label: 'Overview', to: '/projects/$id/overview' as const },
    { label: 'Flow', to: '/projects/$id/flow' as const },
    { label: 'Board', to: '/projects/$id/board' as const },
  ];

  return (
    <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ id: projectId }}
          style={{ color: '#555', textDecoration: 'none' }}
          activeProps={{ style: { color: '#1a56db', fontWeight: 600 } }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function ProjectOverviewPage() {
  const { id } = Route.useParams();
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
      <ProjectNav projectId={id} />
      <h1 style={{ marginTop: 0 }}>{project.name}</h1>
      {project.description ? <p style={{ color: '#666' }}>{project.description}</p> : null}

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Task status summary</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
        {taskStatuses.map((status) => (
          <li
            key={status}
            style={{ display: 'flex', justifyContent: 'space-between', maxWidth: '16rem' }}
          >
            <span>{status.replace('_', ' ')}</span>
            <strong>{project.summary[status]}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/overview')({
  component: ProjectOverviewPage,
});
