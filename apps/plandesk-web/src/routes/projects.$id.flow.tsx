import { createFileRoute } from '@tanstack/react-router';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { FlowCanvas } from '../components/canvas/FlowCanvas.js';
import { ProjectNav } from '../components/layout/ProjectNav.js';
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
      <ProjectNav projectId={id} />
      <h1 style={{ marginTop: 0 }}>{project.name} — Flow</h1>
      {status !== undefined ? (
        <p style={{ color: '#666', marginTop: 0 }}>Filter: {status}</p>
      ) : null}
      <div style={{ position: 'relative' }}>
        <AgentRunsPanel projectId={id} />
        <FlowCanvas projectId={id} />
      </div>
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/flow')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectFlowPage,
});
