import { Link, createFileRoute } from '@tanstack/react-router';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { FileIssue } from '../components/inbox/FileIssue.js';
import { InboxPanel } from '../components/inbox/InboxPanel.js';
import { useProject } from '../lib/queries.js';

function ProjectNav({ projectId }: { projectId: string }) {
  const tabs = [
    { label: 'Overview', to: '/projects/$id/overview' as const },
    { label: 'Flow', to: '/projects/$id/flow' as const },
    { label: 'Board', to: '/projects/$id/board' as const },
    { label: 'Notes', to: '/projects/$id/notes' as const },
    { label: 'Inbox', to: '/projects/$id/inbox' as const },
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

function ProjectInboxPage() {
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
      <h1 style={{ marginTop: 0 }}>{project.name} — Inbox</h1>

      <FileIssue projectId={id} />
      <InboxPanel projectId={id} />

      <div style={{ position: 'relative', minHeight: '18rem' }}>
        <AgentRunsPanel projectId={id} />
      </div>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/inbox')({
  component: ProjectInboxPage,
});
