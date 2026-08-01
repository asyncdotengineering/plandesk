import {
  taskPriorityOrder,
  taskStatuses,
  type SerializedTask,
  type TaskPriority,
  type TaskStatus,
} from '../../lib/api.js';
import { sortTasks, type SortSpec } from './task-sort.js';

export type GroupableField =
  | 'status'
  | 'goal_id'
  | 'assignee'
  | 'priority'
  | 'blocked'
  | 'tag';

export type GroupSpec = {
  field: GroupableField;
  direction: 'asc' | 'desc';
};

export type GroupSpecs = [GroupSpec] | [GroupSpec, GroupSpec];

export type AggregateOp =
  | 'count'
  | 'count_non_empty'
  | 'percent_of_parent'
  | 'earliest'
  | 'latest';

export type AggregateField =
  | 'label'
  | 'status'
  | 'assignee'
  | 'priority'
  | 'due_date'
  | 'created_at'
  | 'updated_at'
  | 'goal_id'
  | 'tag'
  | 'blocked';

export type AggregateSpec = {
  field: AggregateField;
  op: AggregateOp;
};

export type AggregateResult = {
  field: AggregateField;
  op: AggregateOp;
  /** Counts and percent (0–100). Dates as ISO strings. Null when no value. */
  value: number | string | null;
};

export type GroupNode = {
  /** Stable path key for collapse state, e.g. `goal_id:g1/status:todo`. */
  id: string;
  field: GroupableField;
  /** Canonical group value; `null` is the empty/"No <field>" bucket. */
  value: string | null;
  label: string;
  tasks: SerializedTask[];
  children: GroupNode[] | null;
  aggregates: AggregateResult[];
};

export const GROUPABLE_FIELDS: readonly GroupableField[] = [
  'status',
  'goal_id',
  'assignee',
  'priority',
  'blocked',
  'tag',
] as const;

export const GROUPABLE_FIELD_LABELS: Record<GroupableField, string> = {
  status: 'Status',
  goal_id: 'Goal',
  assignee: 'Assignee',
  priority: 'Priority',
  blocked: 'Blocked',
  tag: 'Tag',
};

const EMPTY_SENTINEL = '__empty__';

const STATUS_ORDER: Record<TaskStatus, number> = Object.fromEntries(
  taskStatuses.map((status, index) => [status, index]),
) as Record<TaskStatus, number>;

function isEmptyText(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function emptyLabel(field: GroupableField): string {
  switch (field) {
    case 'goal_id':
      return 'No goal';
    case 'tag':
      return 'No tag';
    case 'status':
      return 'No status';
    case 'assignee':
      return 'No assignee';
    case 'priority':
      return 'No priority';
    case 'blocked':
      return 'No blocked';
  }
}

function displayLabel(field: GroupableField, value: string | null): string {
  if (value === null) {
    return emptyLabel(field);
  }
  if (field === 'blocked') {
    return value === 'true' ? 'Blocked' : 'Not blocked';
  }
  return value;
}

type Membership = { key: string; value: string | null };

function memberships(task: SerializedTask, field: GroupableField): Membership[] {
  switch (field) {
    case 'status':
      return [{ key: task.status, value: task.status }];
    case 'goal_id':
      return isEmptyText(task.goal_id)
        ? [{ key: EMPTY_SENTINEL, value: null }]
        : [{ key: task.goal_id, value: task.goal_id }];
    case 'assignee': {
      const assignee = task.assignee;
      if (assignee === null || assignee === '') {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return [{ key: assignee, value: assignee }];
    }
    case 'priority': {
      const priority: TaskPriority | null = task.priority;
      return priority === null
        ? [{ key: EMPTY_SENTINEL, value: null }]
        : [{ key: priority, value: priority }];
    }
    case 'blocked': {
      if (task.blocked === undefined) {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      const key = task.blocked ? 'true' : 'false';
      return [{ key, value: key }];
    }
    case 'tag': {
      const tags = task.tags ?? [];
      if (tags.length === 0) {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return tags.map((tag) => ({ key: tag.name, value: tag.name }));
    }
  }
}

function compareNonEmptyGroupValues(
  field: GroupableField,
  a: string,
  b: string,
  collator: Intl.Collator,
): number {
  switch (field) {
    case 'status':
      return STATUS_ORDER[a as TaskStatus] - STATUS_ORDER[b as TaskStatus];
    case 'priority':
      return taskPriorityOrder[a as TaskPriority] - taskPriorityOrder[b as TaskPriority];
    case 'blocked':
      // asc: Not blocked (false) before Blocked (true)
      return a === b ? 0 : a === 'false' ? -1 : 1;
    case 'goal_id':
    case 'assignee':
    case 'tag':
      return collator.compare(a, b);
  }
}

function fieldNonEmpty(task: SerializedTask, field: AggregateField): boolean {
  switch (field) {
    case 'label':
      return !isEmptyText(task.label);
    case 'status':
      return true;
    case 'assignee':
      return !isEmptyText(task.assignee);
    case 'priority':
      return task.priority !== null;
    case 'due_date':
      return task.due_date !== null;
    case 'created_at':
      return !isEmptyText(task.created_at);
    case 'updated_at':
      return !isEmptyText(task.updated_at);
    case 'goal_id':
      return !isEmptyText(task.goal_id);
    case 'tag':
      return (task.tags ?? []).length > 0;
    case 'blocked':
      return task.blocked !== undefined;
  }
}

function dateValue(task: SerializedTask, field: AggregateField): number | null {
  let iso: string | null = null;
  switch (field) {
    case 'due_date':
      iso = task.due_date;
      break;
    case 'created_at':
      iso = task.created_at;
      break;
    case 'updated_at':
      iso = task.updated_at;
      break;
    default:
      return null;
  }
  if (iso === null) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function computeAggregates(
  tasks: SerializedTask[],
  specs: AggregateSpec[],
  parentCount: number,
): AggregateResult[] {
  return specs.map((spec) => {
    switch (spec.op) {
      case 'count':
        return { field: spec.field, op: spec.op, value: tasks.length };
      case 'count_non_empty':
        return {
          field: spec.field,
          op: spec.op,
          value: tasks.filter((task) => fieldNonEmpty(task, spec.field)).length,
        };
      case 'percent_of_parent': {
        if (parentCount === 0) {
          return { field: spec.field, op: spec.op, value: 0 };
        }
        return {
          field: spec.field,
          op: spec.op,
          value: (tasks.length / parentCount) * 100,
        };
      }
      case 'earliest':
      case 'latest': {
        let bestMs: number | null = null;
        let bestIso: string | null = null;
        for (const task of tasks) {
          const ms = dateValue(task, spec.field);
          if (ms === null) {
            continue;
          }
          const iso =
            spec.field === 'due_date'
              ? task.due_date
              : spec.field === 'created_at'
                ? task.created_at
                : task.updated_at;
          if (
            bestMs === null ||
            (spec.op === 'earliest' ? ms < bestMs : ms > bestMs)
          ) {
            bestMs = ms;
            bestIso = iso;
          }
        }
        return { field: spec.field, op: spec.op, value: bestIso };
      }
    }
  });
}

export type GroupTasksOptions = {
  aggregates?: AggregateSpec[];
  /** Applied to leaf task lists via `sortTasks` — never reimplemented here. */
  sort?: SortSpec[];
};

function groupLevel(
  tasks: SerializedTask[],
  specs: GroupSpecs,
  level: 0 | 1,
  parentCount: number,
  pathPrefix: string,
  options: GroupTasksOptions,
  collator: Intl.Collator,
): GroupNode[] {
  const spec = specs[level];
  if (spec === undefined) {
    return [];
  }

  const buckets = new Map<string, { value: string | null; tasks: SerializedTask[] }>();

  for (const task of tasks) {
    for (const membership of memberships(task, spec.field)) {
      const existing = buckets.get(membership.key);
      if (existing !== undefined) {
        existing.tasks.push(task);
      } else {
        buckets.set(membership.key, { value: membership.value, tasks: [task] });
      }
    }
  }

  const entries = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    value: bucket.value,
    tasks: bucket.tasks,
  }));

  entries.sort((left, right) => {
    // Empty/"No <field>" is always last, regardless of direction.
    if (left.value === null && right.value === null) {
      return 0;
    }
    if (left.value === null) {
      return 1;
    }
    if (right.value === null) {
      return -1;
    }
    const cmp = compareNonEmptyGroupValues(spec.field, left.value, right.value, collator);
    return spec.direction === 'asc' ? cmp : -cmp;
  });

  const hasChild = level === 0 && specs.length === 2;
  const aggregateSpecs = options.aggregates ?? [{ field: 'label', op: 'count' }];
  const sortSpecs = options.sort ?? [];

  return entries.map((entry) => {
    const idSuffix = `${spec.field}:${entry.key}`;
    const id = pathPrefix === '' ? idSuffix : `${pathPrefix}/${idSuffix}`;
    const children = hasChild
      ? groupLevel(
          entry.tasks,
          specs,
          1,
          entry.tasks.length,
          id,
          options,
          collator,
        )
      : null;
    const leafTasks =
      children === null ? sortTasks(entry.tasks, sortSpecs) : entry.tasks;

    return {
      id,
      field: spec.field,
      value: entry.value,
      label: displayLabel(spec.field, entry.value),
      tasks: leafTasks,
      children,
      aggregates: computeAggregates(entry.tasks, aggregateSpecs, parentCount),
    };
  });
}

/**
 * Group tasks by one or two fields. Tag membership fans a task into every
 * matching tag group. Null/empty values land in one "No <field>" group, last.
 * Leaf task order comes from `sortTasks` when `options.sort` is provided.
 */
export function groupTasks(
  tasks: SerializedTask[],
  specs: GroupSpecs,
  options: GroupTasksOptions = {},
): GroupNode[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return groupLevel(tasks, specs, 0, tasks.length, '', options, collator);
}

/**
 * True when a `tag` grouping level fans tasks so memberships exceed the
 * parent task count (top-level or nested).
 */
export function groupCountsExceedTaskTotal(
  groups: GroupNode[],
  parentTaskCount: number,
): boolean {
  if (groups.length === 0) {
    return false;
  }
  if (groups[0]?.field === 'tag') {
    const memberships = groups.reduce((sum, group) => sum + group.tasks.length, 0);
    return memberships > parentTaskCount;
  }
  return groups.some(
    (group) =>
      group.children !== null &&
      groupCountsExceedTaskTotal(group.children, group.tasks.length),
  );
}

export function formatAggregate(result: AggregateResult): string {
  switch (result.op) {
    case 'count':
      return String(result.value ?? 0);
    case 'count_non_empty':
      return `${String(result.value ?? 0)} filled`;
    case 'percent_of_parent': {
      const n = typeof result.value === 'number' ? result.value : 0;
      return `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
    }
    case 'earliest':
      return result.value === null ? '—' : `earliest ${String(result.value)}`;
    case 'latest':
      return result.value === null ? '—' : `latest ${String(result.value)}`;
  }
}

export const TAG_COUNT_NOTE =
  'Group totals exceed the task count — tasks with multiple tags appear in each tag group.';
