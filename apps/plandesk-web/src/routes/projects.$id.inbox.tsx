import { createFileRoute } from '@tanstack/react-router';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { FileIssue } from '../components/inbox/FileIssue.js';
import { InboxPanel } from '../components/inbox/InboxPanel.js';
import { useProject } from '../lib/queries.js';

function ProjectInboxPage() {
  const { id } = Route.useParams();
  const { data: project, isLoading, error } = useProject(id);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load project: {error.message}
      </p>
    );
  }

  if (project === undefined) {
    return <p className="text-sm text-muted-foreground">Project not found.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <FileIssue projectId={id} />
      <InboxPanel projectId={id} />
      <div className="relative min-h-72">
        <AgentRunsPanel projectId={id} />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/inbox')({
  component: ProjectInboxPage,
});