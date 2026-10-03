import {
  FIELD_OPERATORS,
  FILTERABLE_FIELDS,
  type FilterableField,
  type FilterNode,
  type FilterOperator,
} from '@plandesk/db/saved-view-config';

export type { FilterableField, FilterNode, FilterOperator };
export { FIELD_OPERATORS, FILTERABLE_FIELDS };
export { evaluateFilter, filterTasks } from '@plandesk/db/view-eval';

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

export function emptyFilterGroup(op: 'and' | 'or' = 'and'): Extract<FilterNode, { kind: 'group' }> {
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
