import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ActivityIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ViewSwitcher } from '../components/board/ViewSwitcher.js';
import { AgentRunsPanel } from '../components/canvas/AgentRunsPanel.js';
import { FlowCanvas } from '../components/canvas/FlowCanvas.js';
import { useIsTouchLayout } from '../lib/breakpoints.js';
import { useProject } from '../lib/queries.js';
import { validateTaskFilterSearch } from '../lib/search.js';

function ProjectFlowPage() {
  const { id } = Route.useParams();
  const { data: project, isLoading, error } = useProject(id);
  // A 300px rail beside the canvas leaves about 90px of graph on a phone.
  const railInSheet = useIsTouchLayout();
  const [runsOpen, setRunsOpen] = useState(false);

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
      <div className="flex shrink-0 items-center gap-2 px-1 pt-1">
        <ViewSwitcher projectId={id} active="flow" />
        {railInSheet ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            data-agent-runs-trigger
            onClick={() => {
              setRunsOpen(true);
            }}
          >
            <ActivityIcon className="size-3.5" />
            Runs
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <FlowCanvas projectId={id} />
        {railInSheet ? (
          <Sheet open={runsOpen} onOpenChange={setRunsOpen}>
            <SheetContent side="bottom" data-agent-runs-sheet className="h-[70dvh] gap-0 p-0">
              <SheetTitle className="sr-only">Agent runs</SheetTitle>
              <SheetDescription className="sr-only">
                Recent agent runs for this project.
              </SheetDescription>
              <AgentRunsPanel projectId={id} className="rounded-none border-0 shadow-none" />
            </SheetContent>
          </Sheet>
        ) : (
          <div className="relative h-full w-[300px] shrink-0 border-l border-border bg-card">
            <AgentRunsPanel projectId={id} className="rounded-none border-0 shadow-none" />
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/projects/$id/flow')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectFlowPage,
});
