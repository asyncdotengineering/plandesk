import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { TaskList } from '../components/board/TaskList.js';
import type { ListColumnId } from '../components/board/list-columns.js';
import type { FilterNode } from '../components/board/task-filter.js';
import type { SortSpec } from '../components/board/task-sort.js';
import { useProject, useTasks } from '../lib/queries.js';
import {
  encodeColumnsParam,
  encodeFilterParam,
  encodeSortParam,
  validateTaskFilterSearch,
} from '../lib/search.js';

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
  const { status, task, sort, columns, filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetch,
  } = useTasks(id, status !== undefined ? { status } : {});

  const visibleColumns = useMemo(
    () => (columns !== undefined ? new Set<ListColumnId>(columns) : undefined),
    [columns],
  );

  const updateSearch = (patch: {
    sort?: SortSpec[];
    columns?: Set<ListColumnId>;
    filter?: FilterNode | null;
  }) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(patch.sort !== undefined
          ? { sort: encodeSortParam(patch.sort) }
          : {}),
        ...(patch.columns !== undefined
          ? { columns: encodeColumnsParam(patch.columns) }
          : {}),
        ...(patch.filter !== undefined
          ? { filter: encodeFilterParam(patch.filter) }
          : {}),
      }),
      replace: true,
    });
  };

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
        sortSpecs={sort}
        visibleColumns={visibleColumns}
        filterRoot={filter ?? null}
        onOpenTaskIdChange={(taskId) => {
          void navigate({
            search: (prev) => ({ ...prev, task: taskId ?? undefined }),
            replace: true,
          });
        }}
        onSortSpecsChange={(specs) => {
          updateSearch({ sort: specs });
        }}
        onVisibleColumnsChange={(next) => {
          updateSearch({ columns: next });
        }}
        onFilterRootChange={(root) => {
          updateSearch({ filter: root });
        }}
      />
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/list')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectListPage,
});
