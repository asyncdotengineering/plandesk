import { Columns3Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type PatchTaskInput,
  type SerializedTask,
  type TaskStatus,
} from '../../lib/api.js';
import {
  useDocuments,
  useGoals,
  usePatchTask,
  useTags,
} from '../../lib/queries.js';
import { documentsByLinkedTask } from '../docs/DocumentsPanel.js';
import { BlockedIndicator } from './BlockedIndicator.js';
import { LANE_TAG_PREFIX } from './board-utils.js';
import {
  formatListDate,
  LIST_COLUMN_LABELS,
  LIST_COLUMNS,
  type ListColumnId,
} from './list-columns.js';
import { StatusChip } from './StatusChip.js';
import { TaskDrawer } from './TaskDrawer.js';
import { TaskListSortMenu } from './TaskListSortMenu.js';
import { sortTasks, type SortSpec } from './task-sort.js';
import { ViewSwitcher } from './ViewSwitcher.js';

type TaskListProps = {
  projectId: string;
  repoUrl?: string | null;
  tasks: SerializedTask[];
  openTaskId?: string | undefined;
  onOpenTaskIdChange?: ((taskId: string | null) => void) | undefined;
};

function defaultVisibleColumns(): Set<ListColumnId> {
  return new Set(LIST_COLUMNS);
}

export function TaskList({
  projectId,
  repoUrl = null,
  tasks,
  openTaskId,
  onOpenTaskIdChange,
}: TaskListProps) {
  const { data: goals } = useGoals(projectId);
  const { data: projectTags } = useTags(projectId);
  const { data: documents } = useDocuments(projectId);
  const patchTask = usePatchTask();

  const goalById = useMemo(
    () => new Map((goals ?? []).map((goal) => [goal.id, goal.objective])),
    [goals],
  );
  const linkedDocsByTask = useMemo(
    () => documentsByLinkedTask(documents ?? []),
    [documents],
  );

  const [visibleColumns, setVisibleColumns] = useState<Set<ListColumnId>>(defaultVisibleColumns);
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>([]);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(openTaskId ?? null);

  const sortedTasks = useMemo(() => sortTasks(tasks, sortSpecs), [tasks, sortSpecs]);

  useEffect(() => {
    setDrawerTaskId(openTaskId ?? null);
  }, [openTaskId]);

  const openTask = (taskId: string | null) => {
    setDrawerTaskId(taskId);
    onOpenTaskIdChange?.(taskId);
  };

  const drawerTask =
    drawerTaskId !== null ? sortedTasks.find((task) => task.id === drawerTaskId) : undefined;
  const tagNames = (projectTags ?? []).map((tag) => tag.name);
  const columnOrder = LIST_COLUMNS.filter((column) => visibleColumns.has(column));

  const toggleColumn = (column: ListColumnId, checked: boolean) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(column);
      } else {
        next.delete(column);
      }
      return next;
    });
  };

  const handleChangeStatus = (taskId: string, status: TaskStatus) => {
    patchTask.mutate(
      { id: taskId, input: { status } },
      { onSuccess: () => toast(`Status updated`) },
    );
  };

  const handleAddTag = (name: string) => {
    if (drawerTask === undefined) {
      return;
    }
    const names = (drawerTask.tags ?? []).map((tag) => tag.name);
    if (names.includes(name)) {
      return;
    }
    patchTask.mutate({ id: drawerTask.id, input: { tags: [...names, name] } });
  };

  const handleRemoveTag = (name: string) => {
    if (drawerTask === undefined) {
      return;
    }
    const names = (drawerTask.tags ?? []).map((tag) => tag.name).filter((n) => n !== name);
    patchTask.mutate({ id: drawerTask.id, input: { tags: names } });
  };

  const handlePatch = (input: PatchTaskInput) => {
    if (drawerTask === undefined) {
      return;
    }
    patchTask.mutate({ id: drawerTask.id, input });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewSwitcher projectId={projectId} active="list" />
        <div className="flex flex-wrap items-center gap-2">
          <TaskListSortMenu specs={sortSpecs} onChange={setSortSpecs} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" aria-label="Columns">
                <Columns3Icon className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LIST_COLUMNS.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={visibleColumns.has(column)}
                  onCheckedChange={(checked) => {
                    toggleColumn(column, checked);
                  }}
                >
                  {LIST_COLUMN_LABELS[column]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {sortedTasks.length === 0 ? (
        <p
          data-list-empty
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          No tasks yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm" data-task-list>
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                {columnOrder.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    data-list-column={column}
                    className="border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                  >
                    {LIST_COLUMN_LABELS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => (
                <tr
                  key={task.id}
                  data-task-id={task.id}
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40"
                  onClick={() => {
                    openTask(task.id);
                  }}
                >
                  {columnOrder.map((column) => (
                    <td
                      key={column}
                      data-list-cell={column}
                      data-task-id={task.id}
                      className="px-3 py-2 align-middle"
                    >
                      <TaskListCell task={task} column={column} goalById={goalById} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskDrawer
        open={drawerTask !== undefined}
        task={drawerTask ?? null}
        repoUrl={repoUrl}
        linkedDocs={
          drawerTask !== undefined ? (linkedDocsByTask.get(drawerTask.id) ?? []) : []
        }
        tagSuggestions={tagNames}
        isSaving={patchTask.isPending}
        onOpenChange={(open) => {
          if (!open) {
            openTask(null);
          }
        }}
        onPatch={handlePatch}
        onChangeStatus={(status) => {
          if (drawerTask !== undefined) {
            handleChangeStatus(drawerTask.id, status);
          }
        }}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />
    </div>
  );
}

function TaskListCell({
  task,
  column,
  goalById,
}: {
  task: SerializedTask;
  column: ListColumnId;
  goalById: Map<string, string>;
}) {
  switch (column) {
    case 'label':
      return <span className="font-medium">{task.label}</span>;
    case 'status':
      return <StatusChip status={task.status} tabIndex={-1} className="pointer-events-none" />;
    case 'goal':
      return (
        <span className="text-muted-foreground">
          {goalById.get(task.goal_id) ?? task.goal_id}
        </span>
      );
    case 'assignee':
      return <span>{task.assignee ?? '—'}</span>;
    case 'tags': {
      const chips = (task.tags ?? []).filter((tag) => !tag.name.startsWith(LANE_TAG_PREFIX));
      if (chips.length === 0) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="flex flex-wrap gap-1">
          {chips.map((tag) => (
            <span
              key={tag.id}
              data-tag-chip={tag.name}
              className="inline-flex items-center rounded-full border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
            >
              {tag.name}
            </span>
          ))}
        </span>
      );
    }
    case 'blocked':
      return <BlockedIndicator blocked={task.blocked} waitingOn={task.waiting_on} />;
    case 'due_date':
      return <span className="mono text-xs text-muted-foreground">{formatListDate(task.due_date)}</span>;
    case 'updated_at':
      return (
        <span className="mono text-xs text-muted-foreground">{formatListDate(task.updated_at)}</span>
      );
    default:
      return null;
  }
}
