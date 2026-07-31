import { createFileRoute } from '@tanstack/react-router';
import { ViewSwitcher } from '../components/board/ViewSwitcher.js';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { FlowCanvas } from '../components/canvas/FlowCanvas.js';
import { useProject } from '../lib/queries.js';
import { validateTaskFilterSearch } from '../lib/search.js';

function ProjectFlowPage() {
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-1 pt-1">
        <ViewSwitcher projectId={id} active="flow" />
      </div>
      <div className="flex min-h-0 flex-1">
      <FlowCanvas projectId={id} />
      <div className="relative h-full w-[300px] shrink-0 border-l border-border bg-card">
        <AgentRunsPanel projectId={id} className="rounded-none border-0 shadow-none" />
      </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/flow')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectFlowPage,
});
