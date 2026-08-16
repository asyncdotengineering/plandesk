import type { SavedViewConfig } from '@plandesk/db';
import { applyViewOrder, type ExportTask } from './view-eval.js';

const COLUMN_HEADERS: Record<string, string> = {
  label: 'Label',
  status: 'Status',
  priority: 'Priority',
  goal: 'Goal',
  goal_id: 'Goal',
  assignee: 'Assignee',
  tags: 'Tags',
  blocked: 'Blocked',
  due_date: 'Due date',
  created_at: 'Created',
  updated_at: 'Updated',
  description: 'Description',
  kind: 'Kind',
};

const GROUP_HEADER = 'Group';

export type ExportTable = {
  headers: string[];
  rows: string[][];
};

function cellValue(
  task: ExportTask,
  column: string,
  goalLabels: ReadonlyMap<string, string>,
): string | null {
  switch (column) {
    case 'label':
      return task.label;
    case 'status':
      return task.status;
    case 'priority':
      return task.priority;
    case 'goal':
    case 'goal_id':
      return isEmptyText(task.goal_id) ? null : (goalLabels.get(task.goal_id) ?? task.goal_id);
    case 'assignee':
      return task.assignee;
    case 'tags':
      return (task.tags ?? []).map((tag) => tag.name).join(', ');
    case 'blocked':
      if (task.blocked === undefined) {
        return null;
      }
      return task.blocked ? 'true' : 'false';
    case 'due_date':
      return task.due_date;
    case 'created_at':
      return task.created_at;
    case 'updated_at':
      return task.updated_at;
    case 'description':
      return task.description;
    case 'kind':
      return null;
    default:
      return null;
  }
}

function isEmptyText(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function resolveColumns(visibleColumns: string[]): string[] {
  const known = visibleColumns.filter((column) => COLUMN_HEADERS[column] !== undefined);
  return known;
}

/**
 * Build a rectangular table from tasks + SavedViewConfig.
 * When grouping is active, a leading Group column is included.
 */
export function buildExportTable(
  tasks: ExportTask[],
  view: SavedViewConfig,
  goalLabels: ReadonlyMap<string, string> = new Map(),
): ExportTable {
  const columns = resolveColumns(view.visibleColumns);
  const ordered = applyViewOrder(tasks, {
    filter: view.filter,
    sort: view.sort,
    group: view.group,
    goalLabels,
  });
  const grouped = view.group !== null;
  const headers = [
    ...(grouped ? [GROUP_HEADER] : []),
    ...columns.map((column) => COLUMN_HEADERS[column] ?? column),
  ];

  const rows = ordered.map(({ groupLabel, task }) => {
    const cells: string[] = [];
    if (grouped) {
      cells.push(groupLabel ?? '');
    }
    for (const column of columns) {
      const value = cellValue(task, column, goalLabels);
      cells.push(value ?? '');
    }
    return cells;
  });

  return { headers, rows };
}
