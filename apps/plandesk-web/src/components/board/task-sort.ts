import { SORTABLE_FIELDS, type SortableField, type SortSpec } from '@plandesk/db/saved-view-config';
import {
  taskPriorityOrder,
  taskStatuses,
  type SerializedTask,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/api.js';

export type { SortableField, SortSpec };
export { SORTABLE_FIELDS };

export const SORTABLE_FIELD_LABELS: Record<SortableField, string> = {
  label: 'Label',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  due_date: 'Due date',
  created_at: 'Created',
  updated_at: 'Updated',
};

const STATUS_ORDER: Record<TaskStatus, number> = Object.fromEntries(
  taskStatuses.map((status, index) => [status, index]),
) as Record<TaskStatus, number>;

function isEmptyText(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function compareNullableNumber(a: number | null, b: number | null): number {
  const aNull = a === null;
  const bNull = b === null;
  if (aNull && bNull) {
    return 0;
  }
  if (aNull) {
    return 1;
  }
  if (bNull) {
    return -1;
  }
  return a - b;
}

function fieldKey(
  task: SerializedTask,
  field: SortableField,
): { kind: 'number'; value: number | null } | { kind: 'text'; value: string | null } {
  switch (field) {
    case 'status':
      return { kind: 'number', value: STATUS_ORDER[task.status] };
    case 'priority': {
      const priority: TaskPriority | null = task.priority;
      return {
        kind: 'number',
        value: priority === null ? null : taskPriorityOrder[priority],
      };
    }
    case 'label':
      return { kind: 'text', value: isEmptyText(task.label) ? null : task.label };
    case 'assignee':
      return { kind: 'text', value: isEmptyText(task.assignee) ? null : task.assignee };
    case 'due_date':
      return {
        kind: 'number',
        value: task.due_date === null ? null : Date.parse(task.due_date),
      };
    case 'created_at':
      return { kind: 'number', value: Date.parse(task.created_at) };
    case 'updated_at':
      return { kind: 'number', value: Date.parse(task.updated_at) };
  }
}

function compareField(
  a: SerializedTask,
  b: SerializedTask,
  field: SortableField,
  collator: Intl.Collator,
): number {
  const left = fieldKey(a, field);
  const right = fieldKey(b, field);

  if (left.kind === 'number' && right.kind === 'number') {
    return compareNullableNumber(left.value, right.value);
  }

  const aNull = left.value === null;
  const bNull = right.value === null;
  if (aNull && bNull) {
    return 0;
  }
  if (aNull) {
    return 1;
  }
  if (bNull) {
    return -1;
  }
  return collator.compare(left.value as string, right.value as string);
}

/**
 * Stable multi-level sort. Specs apply in array order (primary → tiebreakers).
 * Null/empty values sort last in ascending order and are never dropped.
 * Equal rows keep their input relative order.
 */
export function sortTasks(tasks: SerializedTask[], specs: SortSpec[]): SerializedTask[] {
  if (specs.length === 0 || tasks.length < 2) {
    return tasks.slice();
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const decorated = tasks.map((task, index) => ({ task, index }));

  decorated.sort((left, right) => {
    for (const spec of specs) {
      const cmp = compareField(left.task, right.task, spec.field, collator);
      if (cmp !== 0) {
        return spec.direction === 'asc' ? cmp : -cmp;
      }
    }
    return left.index - right.index;
  });

  return decorated.map((entry) => entry.task);
}
