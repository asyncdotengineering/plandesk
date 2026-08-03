import {
  FIELD_OPERATORS,
  FILTERABLE_FIELDS,
  type FilterableField,
  type FilterNode,
  type FilterOperator,
} from '@plandesk/db/saved-view-config';
import {
  type SerializedTask,
} from '../../lib/api.js';
import { laneFromTags, LANE_TAG_PREFIX } from './board-utils.js';

export type { FilterableField, FilterNode, FilterOperator };
export { FIELD_OPERATORS, FILTERABLE_FIELDS };

export const FILTERABLE_FIELD_LABELS: Record<FilterableField, string> = {
  label: 'Label',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  tags: 'Tags',
  lane: 'Lane',
  due_date: 'Due date',
  created_at: 'Created',
  updated_at: 'Updated',
  goal_id: 'Goal',
  blocked: 'Blocked',
};

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  before: 'before',
  after: 'after',
};

export function operatorsForField(field: FilterableField): readonly FilterOperator[] {
  return FIELD_OPERATORS[field];
}

/** Tags default to `contains` ("has this tag"); everything else defaults to `is`. */
export function defaultOperatorForField(field: FilterableField): FilterOperator {
  if (field === 'tags') {
    return 'contains';
  }
  const ops = FIELD_OPERATORS[field];
  const first = ops[0];
  if (first === undefined) {
    throw new Error(`no operators registered for field ${field}`);
  }
  return first;
}

export function operatorNeedsValue(operator: FilterOperator): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty';
}

export function emptyFilterGroup(
  op: 'and' | 'or' = 'and',
): Extract<FilterNode, { kind: 'group' }> {
  return { kind: 'group', op, children: [] };
}

export function defaultCondition(field: FilterableField = 'status'): FilterNode {
  return {
    kind: 'condition',
    field,
    operator: defaultOperatorForField(field),
    value: field === 'status' ? 'todo' : '',
  };
}

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

function tagNames(task: SerializedTask): string[] {
  return (task.tags ?? [])
    .map((tag) => tag.name)
    .filter((name) => !name.startsWith(LANE_TAG_PREFIX));
}

function fieldIsEmpty(task: SerializedTask, field: FilterableField): boolean {
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
      return (task.lane ?? laneFromTags(task.tags)) === undefined;
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

function textValue(task: SerializedTask, field: FilterableField): string | null {
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
      return task.lane ?? laneFromTags(task.tags) ?? null;
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
  task: SerializedTask,
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
export function evaluateFilter(task: SerializedTask, node: FilterNode): boolean {
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
export function filterTasks(
  tasks: SerializedTask[],
  root: FilterNode | null,
): SerializedTask[] {
  if (root === null) {
    return tasks.slice();
  }
  return tasks.filter((task) => evaluateFilter(task, root));
}

/** Count of condition nodes — used for the Filter button badge. */
export function countFilterConditions(node: FilterNode | null): number {
  if (node === null) {
    return 0;
  }
  if (node.kind === 'condition') {
    return 1;
  }
  return node.children.reduce((sum, child) => sum + countFilterConditions(child), 0);
}
