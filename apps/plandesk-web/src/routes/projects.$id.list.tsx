import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { TaskList } from '../components/board/TaskList.js';
import { buildListViewConfig } from '../components/board/list-view-config.js';
import { LIST_COLUMNS, type ListColumnId } from '../components/board/list-columns.js';
import type { FilterNode } from '../components/board/task-filter.js';
import type { GroupSpec } from '../components/board/task-group.js';
import type { SortSpec } from '../components/board/task-sort.js';
import type { SerializedView } from '../lib/api.js';
import {
  useCreateView,
  useDeleteView,
  usePatchView,
  useProject,
  useTasks,
  useViews,
} from '../lib/queries.js';
import {
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

function defaultVisibleColumns(): Set<ListColumnId> {
  return new Set(LIST_COLUMNS);
}

function ProjectListPage() {
  const { id } = Route.useParams();
  const { status, task, sort, columns, filter, group, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(id);
  const { data: savedViews } = useViews(id);
  const createView = useCreateView(id);
  const patchView = usePatchView(id);
  const deleteViewMutation = useDeleteView(id);
  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
    refetch,
  } = useTasks(id, status !== undefined ? { status } : {});

  const visibleColumns = useMemo(
    () => (columns !== undefined ? new Set<ListColumnId>(columns) : defaultVisibleColumns()),
    [columns],
  );

  /** An empty list drops the search param entirely, as the encoders did. */
  const omitEmpty = <T,>(items: T[]): T[] | undefined => (items.length > 0 ? items : undefined);

  const updateSearch = (patch: {
    sort?: SortSpec[];
    columns?: Set<ListColumnId>;
    filter?: FilterNode | null;
    group?: GroupSpec[];
    view?: string | undefined;
  }) => {
    // Search params carry the DECODED value, not the encoded wire string:
    // validateTaskFilterSearch is this route's validateSearch, so TanStack types
    // this argument against its output. The parsers accept both forms, so the
    // compact `?sort=field:dir` URL still works when typed by hand or shared.
    // An empty list omits the param, matching what the encoders did.
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(patch.sort !== undefined ? { sort: omitEmpty(patch.sort) } : {}),
        ...(patch.columns !== undefined ? { columns: omitEmpty([...patch.columns]) } : {}),
        ...(patch.filter !== undefined ? { filter: patch.filter ?? undefined } : {}),
        ...(patch.group !== undefined ? { group: omitEmpty(patch.group) } : {}),
        ...('view' in patch ? { view: patch.view } : {}),
      }),
      replace: true,
    });
  };

  const applySavedView = (saved: SerializedView) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        status: prev.status,
        task: undefined,
        view: saved.id,
        sort: omitEmpty(saved.config.sort),
        filter: saved.config.filter ?? undefined,
        // SavedViewConfig.visibleColumns is string[] — the db package cannot know
        // the web's ListColumnId union. Narrow through LIST_COLUMNS rather than
        // casting, so a stored column this build no longer has is dropped.
        columns: omitEmpty(
          LIST_COLUMNS.filter((column) => saved.config.visibleColumns.includes(column)),
        ),
        group: saved.config.group !== null ? omitEmpty([...saved.config.group]) : undefined,
      }),
      replace: true,
    });
  };

  const currentConfig = () =>
    buildListViewConfig({
      filter: filter ?? null,
      sort: sort ?? [],
      groupSpecs: group ?? [],
      visibleColumns,
    });

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
        groupSpecs={group}
        savedViews={savedViews ?? []}
        activeViewId={view}
        onOpenTaskIdChange={(taskId) => {
          void navigate({
            search: (prev) => ({ ...prev, task: taskId ?? undefined }),
            replace: true,
          });
        }}
        onSortSpecsChange={(specs) => {
          updateSearch({ sort: specs, view: undefined });
        }}
        onVisibleColumnsChange={(next) => {
          updateSearch({ columns: next, view: undefined });
        }}
        onFilterRootChange={(root) => {
          updateSearch({ filter: root, view: undefined });
        }}
        onGroupSpecsChange={(specs) => {
          updateSearch({ group: specs, view: undefined });
        }}
        onSelectSavedView={applySavedView}
        onSaveSavedView={(name) => {
          void createView.mutateAsync({ name, config: currentConfig() }).then((created) => {
            applySavedView(created);
          });
        }}
        onRenameSavedView={(viewId, name) => {
          patchView.mutate({ id: viewId, input: { name } });
        }}
        onDeleteSavedView={(viewId) => {
          deleteViewMutation.mutate(viewId);
          if (view === viewId) {
            updateSearch({ view: undefined });
          }
        }}
        isSavingView={createView.isPending}
      />
    </section>
  );
}

export const Route = createFileRoute('/projects/$id/list')({
  validateSearch: validateTaskFilterSearch,
  component: ProjectListPage,
});
