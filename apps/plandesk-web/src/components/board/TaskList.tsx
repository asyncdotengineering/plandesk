import {
  ChevronDownIcon,
  ChevronRightIcon,
  Columns3Icon,
  DownloadIcon,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SAVED_VIEW_CONFIG_VERSION } from '@plandesk/db/saved-view-config';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  exportProjectView,
  type ExportFormat,
  type PatchTaskInput,
  type SerializedTask,
  type SerializedView,
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
import { SavedViewsMenu } from './SavedViewsMenu.js';
import { TaskListFilterMenu } from './TaskListFilterMenu.js';
import { TaskListGroupMenu, toGroupSpecs } from './TaskListGroupMenu.js';
import { TaskListSortMenu } from './TaskListSortMenu.js';
import {
  filterTasks,
  type FilterNode,
} from './task-filter.js';
import {
  TAG_COUNT_NOTE,
  formatAggregate,
  groupCountsExceedTaskTotal,
  groupTasks,
  type GroupNode,
  type GroupSpec,
} from './task-group.js';
import {
  loadCollapsedGroupIds,
  saveCollapsedGroupIds,
} from './list-group-collapse.js';
import { sortTasks, type SortSpec } from './task-sort.js';
import { ViewSwitcher } from './ViewSwitcher.js';

type TaskListProps = {
  projectId: string;
  repoUrl?: string | null;
  tasks: SerializedTask[];
  openTaskId?: string | undefined;
  onOpenTaskIdChange?: ((taskId: string | null) => void) | undefined;
  sortSpecs?: SortSpec[];
  onSortSpecsChange?: (specs: SortSpec[]) => void;
  visibleColumns?: Set<ListColumnId>;
  onVisibleColumnsChange?: (columns: Set<ListColumnId>) => void;
  filterRoot?: FilterNode | null;
  onFilterRootChange?: (root: FilterNode | null) => void;
  groupSpecs?: GroupSpec[];
  onGroupSpecsChange?: (specs: GroupSpec[]) => void;
  savedViews?: SerializedView[];
  activeViewId?: string;
  onSelectSavedView?: (view: SerializedView) => void;
  onSaveSavedView?: (name: string) => void;
  onRenameSavedView?: (viewId: string, name: string) => void;
  onDeleteSavedView?: (viewId: string) => void;
  isSavingView?: boolean;
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
  sortSpecs: sortSpecsProp,
  onSortSpecsChange,
  visibleColumns: visibleColumnsProp,
  onVisibleColumnsChange,
  filterRoot: filterRootProp,
  onFilterRootChange,
  groupSpecs: groupSpecsProp,
  onGroupSpecsChange,
  savedViews = [],
  activeViewId,
  onSelectSavedView,
  onSaveSavedView,
  onRenameSavedView,
  onDeleteSavedView,
  isSavingView = false,
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

  const [visibleColumnsState, setVisibleColumnsState] = useState<Set<ListColumnId>>(defaultVisibleColumns);
  const [filterRootState, setFilterRootState] = useState<FilterNode | null>(null);
  const [sortSpecsState, setSortSpecsState] = useState<SortSpec[]>([]);
  const [groupSpecsState, setGroupSpecsState] = useState<GroupSpec[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => loadCollapsedGroupIds(projectId) ?? new Set(),
  );
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(openTaskId ?? null);

  const visibleColumns =
    onVisibleColumnsChange !== undefined
      ? (visibleColumnsProp ?? defaultVisibleColumns())
      : (visibleColumnsProp ?? visibleColumnsState);
  const sortSpecs =
    onSortSpecsChange !== undefined ? (sortSpecsProp ?? []) : (sortSpecsProp ?? sortSpecsState);
  const filterRoot =
    onFilterRootChange !== undefined
      ? (filterRootProp ?? null)
      : (filterRootProp ?? filterRootState);
  const groupSpecs =
    onGroupSpecsChange !== undefined ? (groupSpecsProp ?? []) : (groupSpecsProp ?? groupSpecsState);

  const setVisibleColumns = (next: Set<ListColumnId>) => {
    if (onVisibleColumnsChange !== undefined) {
      onVisibleColumnsChange(next);
    } else {
      setVisibleColumnsState(next);
    }
  };

  const setSortSpecs = (specs: SortSpec[]) => {
    if (onSortSpecsChange !== undefined) {
      onSortSpecsChange(specs);
    } else {
      setSortSpecsState(specs);
    }
  };

  const setFilterRoot = (root: FilterNode | null) => {
    if (onFilterRootChange !== undefined) {
      onFilterRootChange(root);
    } else {
      setFilterRootState(root);
    }
  };

  const setGroupSpecs = (specs: GroupSpec[]) => {
    if (onGroupSpecsChange !== undefined) {
      onGroupSpecsChange(specs);
    } else {
      setGroupSpecsState(specs);
    }
  };

  const activeGroupSpecs = useMemo(() => toGroupSpecs(groupSpecs), [groupSpecs]);

  // Filter → group → sort within groups (or flat sort when ungrouped).
  const filteredTasks = useMemo(
    () => filterTasks(tasks, filterRoot),
    [tasks, filterRoot],
  );

  const sortedTasks = useMemo(
    () => sortTasks(filteredTasks, sortSpecs),
    [filteredTasks, sortSpecs],
  );

  const groupedTasks = useMemo(() => {
    if (activeGroupSpecs === null) {
      return null;
    }
    return groupTasks(filteredTasks, activeGroupSpecs, {
      sort: sortSpecs,
      aggregates: [
        { field: 'label', op: 'count' },
        { field: 'status', op: 'done_total' },
      ],
    });
  }, [filteredTasks, activeGroupSpecs, sortSpecs]);

  const showTagCountNote =
    groupedTasks !== null &&
    groupSpecs.some((spec) => spec.field === 'tag') &&
    groupCountsExceedTaskTotal(groupedTasks, filteredTasks.length);

  useEffect(() => {
    setDrawerTaskId(openTaskId ?? null);
  }, [openTaskId]);

  useEffect(() => {
    saveCollapsedGroupIds(projectId, collapsedGroupIds);
  }, [projectId, collapsedGroupIds]);

  const openTask = (taskId: string | null) => {
    setDrawerTaskId(taskId);
    onOpenTaskIdChange?.(taskId);
  };

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const drawerTask =
    drawerTaskId !== null ? tasks.find((task) => task.id === drawerTaskId) : undefined;
  const tagNames = (projectTags ?? []).map((tag) => tag.name);
  const columnOrder = LIST_COLUMNS.filter((column) => visibleColumns.has(column));

  const handleExport = (format: ExportFormat) => {
    void (async () => {
      try {
        const { blob, filename } = await exportProjectView(projectId, {
          format,
          view: {
            version: SAVED_VIEW_CONFIG_VERSION,
            filter: filterRoot,
            sort: sortSpecs,
            group: activeGroupSpecs,
            visibleColumns: columnOrder,
          },
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch {
        toast.error('Export failed');
      }
    })();
  };

  const toggleColumn = (column: ListColumnId, checked: boolean) => {
    const next = new Set(visibleColumns);
    if (checked) {
      next.add(column);
    } else {
      next.delete(column);
    }
    setVisibleColumns(next);
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
          {onSelectSavedView !== undefined &&
          onSaveSavedView !== undefined &&
          onRenameSavedView !== undefined &&
          onDeleteSavedView !== undefined ? (
            <SavedViewsMenu
              views={savedViews}
              activeViewId={activeViewId}
              onSelect={onSelectSavedView}
              onSave={onSaveSavedView}
              onRename={onRenameSavedView}
              onDelete={onDeleteSavedView}
              isSaving={isSavingView}
            />
          ) : null}
          <TaskListFilterMenu
            root={filterRoot}
            onChange={setFilterRoot}
            tagSuggestions={tagNames}
          />
          <TaskListGroupMenu specs={groupSpecs} onChange={setGroupSpecs} />
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" aria-label="Export">
                <DownloadIcon className="size-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>Download</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  handleExport('csv');
                }}
              >
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  handleExport('xlsx');
                }}
              >
                Excel (XLSX)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p
          data-list-empty
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          No tasks yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          {showTagCountNote ? (
            <p
              data-group-tag-note
              className="border-b border-border px-3 py-2 text-xs text-muted-foreground"
            >
              {TAG_COUNT_NOTE}
            </p>
          ) : null}
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
              {groupedTasks === null
                ? sortedTasks.map((task) => (
                    <TaskListRow
                      key={task.id}
                      task={task}
                      columnOrder={columnOrder}
                      goalById={goalById}
                      onOpen={openTask}
                    />
                  ))
                : groupedTasks.map((group) => (
                    <GroupRows
                      key={group.id}
                      group={group}
                      depth={0}
                      columnCount={columnOrder.length}
                      columnOrder={columnOrder}
                      goalById={goalById}
                      collapsedGroupIds={collapsedGroupIds}
                      onToggleCollapsed={toggleGroupCollapsed}
                      onOpenTask={openTask}
                    />
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

function TaskListRow({
  task,
  columnOrder,
  goalById,
  onOpen,
}: {
  task: SerializedTask;
  columnOrder: ListColumnId[];
  goalById: Map<string, string>;
  onOpen: (taskId: string) => void;
}) {
  return (
    <tr
      data-task-id={task.id}
      className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40"
      onClick={() => {
        onOpen(task.id);
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
  );
}

function groupHeaderLabel(group: GroupNode, goalById: Map<string, string>): string {
  if (group.field === 'goal_id' && group.value !== null) {
    return goalById.get(group.value) ?? group.value;
  }
  return group.label;
}

function GroupRows({
  group,
  depth,
  columnCount,
  columnOrder,
  goalById,
  collapsedGroupIds,
  onToggleCollapsed,
  onOpenTask,
}: {
  group: GroupNode;
  depth: number;
  columnCount: number;
  columnOrder: ListColumnId[];
  goalById: Map<string, string>;
  collapsedGroupIds: Set<string>;
  onToggleCollapsed: (groupId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const collapsed = collapsedGroupIds.has(group.id);
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
  const aggregateText = group.aggregates.map((entry) => formatAggregate(entry)).join(' · ');

  return (
    <Fragment>
      <tr
        data-group-id={group.id}
        data-group-field={group.field}
        data-group-depth={depth}
        data-group-collapsed={collapsed ? 'true' : 'false'}
        className="border-b border-border bg-muted/50"
      >
        <td colSpan={columnCount} className="px-2 py-1.5">
          <button
            type="button"
            data-group-toggle={group.id}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} group ${groupHeaderLabel(group, goalById)}`}
            className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs font-medium hover:bg-muted"
            style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}
            onClick={() => {
              onToggleCollapsed(group.id);
            }}
          >
            <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
            <span data-group-label>{groupHeaderLabel(group, goalById)}</span>
            <span data-group-aggregates className="font-normal text-muted-foreground">
              {aggregateText}
            </span>
          </button>
        </td>
      </tr>
      {collapsed ? null : group.children !== null ? (
        group.children.map((child) => (
          <GroupRows
            key={child.id}
            group={child}
            depth={depth + 1}
            columnCount={columnCount}
            columnOrder={columnOrder}
            goalById={goalById}
            collapsedGroupIds={collapsedGroupIds}
            onToggleCollapsed={onToggleCollapsed}
            onOpenTask={onOpenTask}
          />
        ))
      ) : (
        group.tasks.map((task) => (
          <TaskListRow
            key={`${group.id}:${task.id}`}
            task={task}
            columnOrder={columnOrder}
            goalById={goalById}
            onOpen={onOpenTask}
          />
        ))
      )}
    </Fragment>
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
