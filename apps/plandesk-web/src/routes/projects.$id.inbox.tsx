import { createFileRoute } from '@tanstack/react-router';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { FileIssue } from '../components/inbox/FileIssue.js';
import { InboxPanel } from '../components/inbox/InboxPanel.js';
import { useProject } from '../lib/queries.js';

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
