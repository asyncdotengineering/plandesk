/**
 * Saved-view evaluation (filter → group → sort within leaves), shared by the
 * web list view and the server report export so both show the same rows.
 *
 * **This module must never import drizzle, node:*, or anything else that cannot
 * run in a browser.** It is published as the `@plandesk/db/view-eval` subpath.
 */
import type {
  FilterableField,
  FilterNode,
  FilterOperator,
  GroupableField,
  GroupSpecs,
  SortableField,
  SortSpec,
} from './saved-view-config.js';
import {
  taskPriorityOrder,
  taskStatuses,
  type TaskPriority,
  type TaskStatus,
} from './vocabulary.js';

/** The task fields a saved view reads. Callers pass any richer task shape. */
export type ViewTask = {
  label: string;
  status: TaskStatus;
  priority: TaskPriority | null;
  lane?: string | null;
  severity?: string | null;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  goal_id: string | null;
  tags?: ReadonlyArray<{ name: string }>;
  blocked?: boolean;
};

export const LANE_TAG_PREFIX = 'lane:';

/** Lane carried as a `lane:<value>` tag (legacy form of the typed `lane` column). */
export function laneFromTags(
  tags: ReadonlyArray<{ name: string }> | undefined,
): string | undefined {
  for (const tag of tags ?? []) {
    if (tag.name.startsWith(LANE_TAG_PREFIX)) {
      return tag.name.slice(LANE_TAG_PREFIX.length);
    }
  }
  return undefined;
}

/** The typed column wins; the `lane:` tag is the fallback. */
function taskLane(task: ViewTask): string | undefined {
  return task.lane ?? laneFromTags(task.tags);
}

const STATUS_ORDER: Record<TaskStatus, number> = Object.fromEntries(
  taskStatuses.map((status, index) => [status, index]),
) as Record<TaskStatus, number>;

function isEmptyText(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

// ── Filter ──────────────────────────────────────────────────────────────────

function tagNames(task: ViewTask): string[] {
  return (task.tags ?? [])
    .map((tag) => tag.name)
    .filter((name) => !name.startsWith(LANE_TAG_PREFIX));
}

function fieldIsEmpty(task: ViewTask, field: FilterableField): boolean {
  switch (field) {
    case 'label':
      return isEmptyText(task.label);
    case 'status':
      return false;
    case 'priority':
      return task.priority === null;
    case 'assignee':
      return isEmptyText(task.assignee);
    case 'tags':
      return tagNames(task).length === 0;
    case 'lane':
      return taskLane(task) === undefined;
    case 'due_date':
      return task.due_date === null;
    case 'created_at':
      return isEmptyText(task.created_at);
    case 'updated_at':
      return isEmptyText(task.updated_at);
    case 'goal_id':
      return isEmptyText(task.goal_id);
    case 'blocked':
      return task.blocked === undefined;
  }
}

function textValue(task: ViewTask, field: FilterableField): string | null {
  switch (field) {
    case 'label':
      return task.label;
    case 'status':
      return task.status;
    case 'priority':
      return task.priority;
    case 'assignee':
      return task.assignee;
    case 'lane':
      return taskLane(task) ?? null;
    case 'goal_id':
      return task.goal_id;
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
    case 'tags':
      return null;
  }
}

function parseDateMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function applyCondition(
  task: ViewTask,
  field: FilterableField,
  operator: FilterOperator,
  value: unknown,
): boolean {
  if (operator === 'is_empty') {
    return fieldIsEmpty(task, field);
  }
  if (operator === 'is_not_empty') {
    return !fieldIsEmpty(task, field);
  }

  const needle = asString(value);

  if (field === 'tags') {
    const names = tagNames(task);
    switch (operator) {
      case 'contains':
        return names.includes(needle);
      case 'does_not_contain':
        return !names.includes(needle);
      case 'is':
        return names.length === 1 && names[0] === needle;
      case 'is_not':
        return !(names.length === 1 && names[0] === needle);
      case 'before':
      case 'after':
        return false;
    }
  }

  if (operator === 'before' || operator === 'after') {
    const left = parseDateMs(textValue(task, field));
    const right = parseDateMs(needle);
    if (left === null || right === null) {
      return false;
    }
    return operator === 'before' ? left < right : left > right;
  }

  const haystack = textValue(task, field);
  const haystackText = haystack ?? '';

  switch (operator) {
    case 'is':
      return haystackText === needle;
    case 'is_not':
      return haystackText !== needle;
    case 'contains':
      return haystackText.toLowerCase().includes(needle.toLowerCase());
    case 'does_not_contain':
      return !haystackText.toLowerCase().includes(needle.toLowerCase());
  }
}

/**
 * Evaluate a filter tree against one task.
 * Empty AND group: matches everything (mid-construction UX).
 * Empty OR group: matches nothing (`[].some` is false).
 */
export function evaluateFilter(task: ViewTask, node: FilterNode): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) {
      return node.op === 'and';
    }
    if (node.op === 'and') {
      return node.children.every((child) => evaluateFilter(task, child));
    }
    return node.children.some((child) => evaluateFilter(task, child));
  }
  return applyCondition(task, node.field, node.operator, node.value);
}

/** Filter tasks by a root node. `null` means no filter (pass-through). */
export function filterTasks<T extends ViewTask>(tasks: T[], root: FilterNode | null): T[] {
  if (root === null) {
    return tasks.slice();
  }
  return tasks.filter((task) => evaluateFilter(task, root));
}

// ── Sort ────────────────────────────────────────────────────────────────────

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
  task: ViewTask,
  field: SortableField,
): { kind: 'number'; value: number | null } | { kind: 'text'; value: string | null } {
  switch (field) {
    case 'status':
      return { kind: 'number', value: STATUS_ORDER[task.status] };
    case 'priority':
      return {
        kind: 'number',
        value: task.priority === null ? null : taskPriorityOrder[task.priority],
      };
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
  a: ViewTask,
  b: ViewTask,
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
export function sortTasks<T extends ViewTask>(tasks: T[], specs: SortSpec[]): T[] {
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

// ── Group ───────────────────────────────────────────────────────────────────

export type AggregateOp =
  | 'count'
  | 'count_non_empty'
  | 'percent_of_parent'
  | 'done_total'
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

export type GroupNode<T extends ViewTask = ViewTask> = {
  /** Stable path key for collapse state, e.g. `goal_id:g1/status:todo`. */
  id: string;
  field: GroupableField;
  /** Canonical group value; `null` is the empty/"No <field>" bucket. */
  value: string | null;
  label: string;
  tasks: T[];
  children: GroupNode<T>[] | null;
  aggregates: AggregateResult[];
};

const EMPTY_SENTINEL = '__empty__';

function emptyLabel(field: GroupableField): string {
  switch (field) {
    case 'goal_id':
      return 'No goal';
    case 'lane':
      return 'No lane';
    case 'severity':
      return 'No severity';
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

function memberships(task: ViewTask, field: GroupableField): Membership[] {
  switch (field) {
    case 'status':
      return [{ key: task.status, value: task.status }];
    case 'goal_id': {
      const goalId = task.goal_id;
      if (goalId === null || goalId === '') {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return [{ key: goalId, value: goalId }];
    }
    case 'assignee': {
      const assignee = task.assignee;
      if (assignee === null || assignee === '') {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return [{ key: assignee, value: assignee }];
    }
    case 'priority': {
      const priority = task.priority;
      return priority === null
        ? [{ key: EMPTY_SENTINEL, value: null }]
        : [{ key: priority, value: priority }];
    }
    case 'lane': {
      const lane = taskLane(task) ?? null;
      if (lane === null || lane === '') {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return [{ key: lane, value: lane }];
    }
    case 'severity': {
      const severity = task.severity ?? null;
      if (severity === null) {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return [{ key: severity, value: severity }];
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
    case 'lane':
    case 'severity':
    case 'assignee':
    case 'tag':
      return collator.compare(a, b);
  }
}

function fieldNonEmpty(task: ViewTask, field: AggregateField): boolean {
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

function dateValue(task: ViewTask, field: AggregateField): number | null {
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
  tasks: ViewTask[],
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
      case 'done_total': {
        const done = tasks.filter((task) => task.status === 'done').length;
        return {
          field: spec.field,
          op: spec.op,
          value: `${String(done)}/${String(tasks.length)}`,
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
          if (bestMs === null || (spec.op === 'earliest' ? ms < bestMs : ms > bestMs)) {
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

function groupLevel<T extends ViewTask>(
  tasks: T[],
  specs: GroupSpecs,
  level: 0 | 1,
  parentCount: number,
  pathPrefix: string,
  options: GroupTasksOptions,
  collator: Intl.Collator,
): GroupNode<T>[] {
  const spec = specs[level];
  if (spec === undefined) {
    return [];
  }

  const buckets = new Map<string, { value: string | null; tasks: T[] }>();

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
      ? groupLevel(entry.tasks, specs, 1, entry.tasks.length, id, options, collator)
      : null;
    const leafTasks = children === null ? sortTasks(entry.tasks, sortSpecs) : entry.tasks;

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
export function groupTasks<T extends ViewTask>(
  tasks: T[],
  specs: GroupSpecs,
  options: GroupTasksOptions = {},
): GroupNode<T>[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return groupLevel(tasks, specs, 0, tasks.length, '', options, collator);
}
