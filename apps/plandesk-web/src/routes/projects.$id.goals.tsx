import { createFileRoute } from '@tanstack/react-router';
import { GoalsPanel } from '../components/goals/GoalsPanel.js';
import { useProject } from '../lib/queries.js';

function ProjectGoalsPage() {
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

  return <GoalsPanel projectId={id} />;
}

export const Route = createFileRoute('/projects/$id/goals')({
  component: ProjectGoalsPage,
});
