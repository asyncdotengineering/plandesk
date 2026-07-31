import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { TaskList } from '../components/board/TaskList.js';
import { useProject, useTasks } from '../lib/queries.js';
import { validateTaskFilterSearch } from '../lib/search.js';

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-muted" />
      ))}
    </div>
  );
}

function ProjectListPage() {
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
    return <ListSkeleton />;
  }

  if (projectError !== null) {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this list.
        </p>
      </div>
    );
  }

  if (tasksError !== null) {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this list.
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
      <TaskList
        projectId={id}
        repoUrl={project.repo_url}
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

export const Route = createFileRoute('/projects/$id/list')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectListPage,
});
