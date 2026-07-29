import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Board } from '../components/board/Board.js';
import { useProject, useTasks } from '../lib/queries.js';
import { validateTaskFilterSearch } from '../lib/search.js';

function BoardSkeleton() {
  return (
    <div className="flex h-full gap-3 overflow-x-auto px-1 py-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-[220px] flex-1 flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
        >
          <div className="mb-1 h-4 w-20 rounded bg-muted" />
          <div className="h-24 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function ProjectBoardPage() {
  const { id } = Route.useParams();
  const { status, task } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetch,
  } = useTasks(id, status !== undefined ? { status } : {});

  if (projectLoading || tasksLoading) {
    return <BoardSkeleton />;
  }

  if (projectError !== null) {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this board.
        </p>
      </div>
    );
  }

  if (tasksError !== null) {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this board.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (project === undefined) {
    return <p>Project not found.</p>;
  }

  return (
    <section className="flex h-full flex-col">
      <Board
        projectId={id}
        tasks={tasks ?? []}
        openTaskId={task}
        onOpenTaskIdChange={(taskId) => {
          void navigate({
            search: (prev) => ({ ...prev, task: taskId ?? undefined }),
            replace: true,
          });
        }}
      />
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/board')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectBoardPage,
});
