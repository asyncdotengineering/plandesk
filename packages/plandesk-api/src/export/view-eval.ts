/**
 * Server-side SavedViewConfig evaluation for report export.
 * Semantics mirror the web list view (filter → group → sort within leaves).
 */
import {
  taskPriorityOrder,
  taskStatuses,
  type FilterableField,
  type FilterNode,
  type FilterOperator,
  type GroupableField,
  type GroupSpec,
  type GroupSpecs,
  type SortableField,
  type SortSpec,
  type TaskPriority,
  type TaskStatus,
} from '@plandesk/db';

export const LANE_TAG_PREFIX = 'lane:';

export type ExportTask = {
  id: string;
  label: string;
  status: string;
  priority: string | null;
  lane?: string | null;
  severity?: string | null;
  description: string | null;
  assignee: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  goal_id: string;
  tags?: Array<{ name: string }>;
  blocked?: boolean;
};

const STATUS_ORDER: Record<string, number> = Object.fromEntries(
  taskStatuses.map((status, index) => [status, index]),
);

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

function tagNames(task: ExportTask): string[] {
  return (task.tags ?? [])
    .map((tag) => tag.name)
    .filter((name) => !name.startsWith(LANE_TAG_PREFIX));
}

function laneFromTags(tags: Array<{ name: string }> | undefined): string | undefined {
  for (const tag of tags ?? []) {
    if (tag.name.startsWith(LANE_TAG_PREFIX)) {
      return tag.name.slice(LANE_TAG_PREFIX.length);
    }
  }
  return undefined;
}

function fieldIsEmpty(task: ExportTask, field: FilterableField): boolean {
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
      return laneFromTags(task.tags) === undefined;
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

function textValue(task: ExportTask, field: FilterableField): string | null {
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
      return laneFromTags(task.tags) ?? null;
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
  task: ExportTask,
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

export function evaluateFilter(task: ExportTask, node: FilterNode): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) {
      return true;
    }
    if (node.op === 'and') {
      return node.children.every((child) => evaluateFilter(task, child));
    }
    return node.children.some((child) => evaluateFilter(task, child));
  }
  return applyCondition(task, node.field, node.operator, node.value);
}

export function filterTasks(tasks: ExportTask[], root: FilterNode | null): ExportTask[] {
  if (root === null) {
    return tasks.slice();
  }
  return tasks.filter((task) => evaluateFilter(task, root));
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
  task: ExportTask,
  field: SortableField,
): { kind: 'number'; value: number | null } | { kind: 'text'; value: string | null } {
  switch (field) {
    case 'status':
      return { kind: 'number', value: STATUS_ORDER[task.status] ?? Number.MAX_SAFE_INTEGER };
    case 'priority': {
      const priority = task.priority as TaskPriority | null;
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
  a: ExportTask,
  b: ExportTask,
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

export function sortTasks(tasks: ExportTask[], specs: SortSpec[]): ExportTask[] {
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

function displayLabel(
  field: GroupableField,
  value: string | null,
  goalLabels: ReadonlyMap<string, string>,
): string {
  if (value === null) {
    return emptyLabel(field);
  }
  if (field === 'blocked') {
    return value === 'true' ? 'Blocked' : 'Not blocked';
  }
  if (field === 'goal_id') {
    return goalLabels.get(value) ?? value;
  }
  return value;
}

type Membership = { key: string; value: string | null };

function memberships(task: ExportTask, field: GroupableField): Membership[] {
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
      const priority = task.priority;
      return priority === null
        ? [{ key: EMPTY_SENTINEL, value: null }]
        : [{ key: priority, value: priority }];
    }
    case 'lane': {
      const lane = task.lane ?? laneFromTags(task.tags) ?? null;
      if (lane === null || lane === '') {
        return [{ key: EMPTY_SENTINEL, value: null }];
      }
      return [{ key: lane, value: lane }];
    }
    case 'severity': {
      const severity = task.severity ?? null;
      if (severity === null || severity === '') {
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
      return (
        (STATUS_ORDER[a as TaskStatus] ?? 0) - (STATUS_ORDER[b as TaskStatus] ?? 0)
      );
    case 'priority':
      return taskPriorityOrder[a as TaskPriority] - taskPriorityOrder[b as TaskPriority];
    case 'blocked':
      return a === b ? 0 : a === 'false' ? -1 : 1;
    case 'goal_id':
    case 'lane':
    case 'severity':
    case 'assignee':
    case 'tag':
      return collator.compare(a, b);
  }
}

export type FlattenedExportRow = {
  groupLabel: string | null;
  task: ExportTask;
};

function flattenGroupLevel(
  tasks: ExportTask[],
  specs: GroupSpecs,
  level: 0 | 1,
  pathLabels: string[],
  sortSpecs: SortSpec[],
  goalLabels: ReadonlyMap<string, string>,
  collator: Intl.Collator,
  out: FlattenedExportRow[],
): void {
  const spec: GroupSpec | undefined = specs[level];
  if (spec === undefined) {
    return;
  }

  const buckets = new Map<string, { value: string | null; tasks: ExportTask[] }>();

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

  for (const entry of entries) {
    const label = displayLabel(spec.field, entry.value, goalLabels);
    const nextPath = [...pathLabels, label];
    if (hasChild) {
      flattenGroupLevel(
        entry.tasks,
        specs,
        1,
        nextPath,
        sortSpecs,
        goalLabels,
        collator,
        out,
      );
    } else {
      const leafTasks = sortTasks(entry.tasks, sortSpecs);
      const groupLabel = nextPath.join(' / ');
      for (const task of leafTasks) {
        out.push({ groupLabel, task });
      }
    }
  }
}

/**
 * Apply filter, then either flat-sort or group-flatten (with leaf sort).
 * Group label is null when grouping is inactive.
 */
export function applyViewOrder(
  tasks: ExportTask[],
  options: {
    filter: FilterNode | null;
    sort: SortSpec[];
    group: GroupSpecs | null;
    goalLabels?: ReadonlyMap<string, string>;
  },
): FlattenedExportRow[] {
  const filtered = filterTasks(tasks, options.filter);
  const goalLabels = options.goalLabels ?? new Map<string, string>();

  if (options.group === null) {
    return sortTasks(filtered, options.sort).map((task) => ({
      groupLabel: null,
      task,
    }));
  }

  const out: FlattenedExportRow[] = [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  flattenGroupLevel(
    filtered,
    options.group,
    0,
    [],
    options.sort,
    goalLabels,
    collator,
    out,
  );
  return out;
}
