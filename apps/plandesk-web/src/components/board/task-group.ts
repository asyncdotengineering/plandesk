import {
  GROUPABLE_FIELDS,
  type GroupableField,
  type GroupSpec,
  type GroupSpecs,
} from '@plandesk/db/saved-view-config';
import type { AggregateResult, GroupNode as ViewGroupNode } from '@plandesk/db/view-eval';
import type { SerializedTask } from '../../lib/api.js';

export type { GroupableField, GroupSpec, GroupSpecs };
export { GROUPABLE_FIELDS };
export type {
  AggregateField,
  AggregateOp,
  AggregateResult,
  AggregateSpec,
  GroupTasksOptions,
} from '@plandesk/db/view-eval';
export { groupTasks } from '@plandesk/db/view-eval';

export type GroupNode = ViewGroupNode<SerializedTask>;

export const GROUPABLE_FIELD_LABELS: Record<GroupableField, string> = {
  status: 'Status',
  goal_id: 'Goal',
  lane: 'Lane',
  severity: 'Severity',
  assignee: 'Assignee',
  priority: 'Priority',
  blocked: 'Blocked',
  tag: 'Tag',
};

/**
 * True when a `tag` grouping level fans tasks so memberships exceed the
 * parent task count (top-level or nested).
 */
export function groupCountsExceedTaskTotal(groups: GroupNode[], parentTaskCount: number): boolean {
  if (groups.length === 0) {
    return false;
  }
  if (groups[0]?.field === 'tag') {
    const memberships = groups.reduce((sum, group) => sum + group.tasks.length, 0);
    return memberships > parentTaskCount;
  }
  return groups.some(
    (group) =>
      group.children !== null && groupCountsExceedTaskTotal(group.children, group.tasks.length),
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
    case 'done_total':
      return result.value === null ? '0/0 done' : `${String(result.value)} done`;
    case 'earliest':
      return result.value === null ? '—' : `earliest ${String(result.value)}`;
    case 'latest':
      return result.value === null ? '—' : `latest ${String(result.value)}`;
  }
}

export const TAG_COUNT_NOTE =
  'Group totals exceed the task count — tasks with multiple tags appear in each tag group.';
