import { describe, expect, it } from 'vitest';
import type { SerializedTag, SerializedTask } from '../../lib/api.js';
import {
  TAG_COUNT_NOTE,
  formatAggregate,
  groupCountsExceedTaskTotal,
  groupTasks,
  type AggregateResult,
  type GroupNode,
} from './task-group.js';

function makeTag(id: string, name: string): SerializedTag {
  return {
    id,
    project_id: 'proj-1',
    name,
    color: null,
    created_at: '2026-06-07T00:00:00.000Z',
  };
}

function makeTask(id: string, overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    project_id: 'proj-1',
    goal_id: 'goal-1',
    label: id,
    status: 'todo',
    priority: 'medium',
    description: null,
    x: 0,
    y: 0,
    assignee: null,
    due_date: null,
    commit_refs: [],
    created_at: '2026-06-07T00:00:00.000Z',
    updated_at: '2026-06-08T00:00:00.000Z',
    tags: [],
    ...overrides,
  };
}

function aggregate(
  node: GroupNode,
  op: AggregateResult['op'],
  field: AggregateResult['field'],
): AggregateResult['value'] {
  const hit = node.aggregates.find((entry) => entry.op === op && entry.field === field);
  expect(hit).toBeDefined();
  if (hit === undefined) {
    throw new Error(`missing aggregate ${op}/${field} on ${node.id}`);
  }
  return hit.value;
}

function leafIds(node: GroupNode): string[] {
  if (node.children === null) {
    return node.tasks.map((task) => task.id);
  }
  return node.children.flatMap(leafIds);
}

describe('groupTasks', () => {
  it('places a two-tag task in both tag groups and flags that totals exceed task count', () => {
    const tasks = [
      makeTask('both', {
        tags: [makeTag('t-a', 'alpha'), makeTag('t-b', 'beta')],
      }),
      makeTask('only-alpha', { tags: [makeTag('t-a2', 'alpha')] }),
      makeTask('untagged', { tags: [] }),
    ];

    const groups = groupTasks(tasks, [{ field: 'tag', direction: 'asc' }]);

    expect(groups.map((group) => group.label)).toEqual(['alpha', 'beta', 'No tag']);

    const alpha = groups.find((group) => group.value === 'alpha');
    const beta = groups.find((group) => group.value === 'beta');
    expect(alpha?.tasks.map((task) => task.id).sort()).toEqual(['both', 'only-alpha']);
    expect(beta?.tasks.map((task) => task.id)).toEqual(['both']);

    const membershipSum = groups.reduce((sum, group) => sum + group.tasks.length, 0);
    expect(membershipSum).toBeGreaterThan(tasks.length);
    expect(groupCountsExceedTaskTotal(groups, tasks.length)).toBe(true);
    expect(TAG_COUNT_NOTE.toLowerCase()).toMatch(/exceed/);
    expect(TAG_COUNT_NOTE.toLowerCase()).toMatch(/tag/);
  });

  it('collects null values into one No <field> group last, without dropping tasks', () => {
    const tasks = [
      makeTask('null-a', { assignee: null }),
      makeTask('blake', { assignee: 'blake' }),
      makeTask('empty', { assignee: '' }),
      makeTask('alex', { assignee: 'alex' }),
      makeTask('null-b', { assignee: null }),
    ];

    const groups = groupTasks(tasks, [{ field: 'assignee', direction: 'asc' }]);

    expect(groups.map((group) => group.label)).toEqual(['alex', 'blake', 'No assignee']);
    expect(groups.at(-1)?.value).toBeNull();
    expect(
      groups
        .at(-1)
        ?.tasks.map((task) => task.id)
        .sort(),
    ).toEqual(['empty', 'null-a', 'null-b']);

    const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
    expect(total).toBe(tasks.length);

    // Desc still keeps the empty bucket last.
    const desc = groupTasks(tasks, [{ field: 'assignee', direction: 'desc' }]);
    expect(desc.map((group) => group.label)).toEqual(['blake', 'alex', 'No assignee']);
    expect(desc.reduce((sum, group) => sum + group.tasks.length, 0)).toBe(tasks.length);
  });

  it('nests status sub-groups inside each goal group', () => {
    const tasks = [
      makeTask('g1-todo', { goal_id: 'goal-1', status: 'todo' }),
      makeTask('g1-scope', { goal_id: 'goal-1', status: 'scope' }),
      makeTask('g2-todo', { goal_id: 'goal-2', status: 'todo' }),
      makeTask('g2-done', { goal_id: 'goal-2', status: 'done' }),
    ];

    const groups = groupTasks(tasks, [
      { field: 'goal_id', direction: 'asc' },
      { field: 'status', direction: 'asc' },
    ]);

    expect(groups.map((group) => group.value)).toEqual(['goal-1', 'goal-2']);
    expect(groups.every((group) => group.children !== null)).toBe(true);

    const g1 = groups[0];
    const g2 = groups[1];
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    if (g1 === undefined || g2 === undefined) {
      throw new Error('expected two goal groups');
    }
    expect(g1.children).not.toBeNull();
    expect(g2.children).not.toBeNull();
    if (g1.children === null || g2.children === null) {
      throw new Error('expected nested status groups');
    }

    expect(g1.children.map((child) => child.value)).toEqual(['scope', 'todo']);
    expect(g1.children.map((child) => child.tasks.map((task) => task.id))).toEqual([
      ['g1-scope'],
      ['g1-todo'],
    ]);
    expect(g2.children.map((child) => child.value)).toEqual(['todo', 'done']);
    expect(leafIds(g2).sort()).toEqual(['g2-done', 'g2-todo']);
  });

  it('matches hand-computed count, earliest due_date, and percent_of_parent', () => {
    // 4 tasks. goal-1 has 3 (75% of parent). Earliest due in goal-1 is Jan 1.
    // goal-2 has 1 (25%). One task in goal-1 has a null due_date → count_non_empty=2.
    const tasks = [
      makeTask('a', {
        goal_id: 'goal-1',
        due_date: '2026-03-01T00:00:00.000Z',
      }),
      makeTask('b', {
        goal_id: 'goal-1',
        due_date: '2026-01-01T00:00:00.000Z',
      }),
      makeTask('c', {
        goal_id: 'goal-1',
        due_date: null,
      }),
      makeTask('d', {
        goal_id: 'goal-2',
        due_date: '2026-02-01T00:00:00.000Z',
      }),
    ];

    const groups = groupTasks(tasks, [{ field: 'goal_id', direction: 'asc' }], {
      aggregates: [
        { field: 'label', op: 'count' },
        { field: 'due_date', op: 'count_non_empty' },
        { field: 'label', op: 'percent_of_parent' },
        { field: 'due_date', op: 'earliest' },
      ],
    });

    const g1 = groups.find((group) => group.value === 'goal-1');
    const g2 = groups.find((group) => group.value === 'goal-2');
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    if (g1 === undefined || g2 === undefined) {
      throw new Error('expected goal groups');
    }

    expect(aggregate(g1, 'count', 'label')).toBe(3);
    expect(aggregate(g1, 'count_non_empty', 'due_date')).toBe(2);
    expect(aggregate(g1, 'percent_of_parent', 'label')).toBe(75);
    expect(aggregate(g1, 'earliest', 'due_date')).toBe('2026-01-01T00:00:00.000Z');

    expect(aggregate(g2, 'count', 'label')).toBe(1);
    expect(aggregate(g2, 'percent_of_parent', 'label')).toBe(25);
    expect(aggregate(g2, 'earliest', 'due_date')).toBe('2026-02-01T00:00:00.000Z');
  });

  it('reports done/total aggregate on each group', () => {
    const tasks = [
      makeTask('g1-todo', { goal_id: 'goal-1', status: 'todo' }),
      makeTask('g1-done', { goal_id: 'goal-1', status: 'done' }),
      makeTask('g2-done', { goal_id: 'goal-2', status: 'done' }),
    ];

    const groups = groupTasks(tasks, [{ field: 'goal_id', direction: 'asc' }], {
      aggregates: [
        { field: 'label', op: 'count' },
        { field: 'status', op: 'done_total' },
      ],
    });

    const g1 = groups.find((group) => group.value === 'goal-1');
    const g2 = groups.find((group) => group.value === 'goal-2');
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    if (g1 === undefined || g2 === undefined) {
      throw new Error('expected goal groups');
    }

    expect(aggregate(g1, 'count', 'label')).toBe(2);
    expect(aggregate(g1, 'done_total', 'status')).toBe('1/2');
    expect(aggregate(g2, 'count', 'label')).toBe(1);
    expect(aggregate(g2, 'done_total', 'status')).toBe('1/1');
    const doneTotal = g1.aggregates.find((entry) => entry.op === 'done_total');
    expect(doneTotal).toBeDefined();
    if (doneTotal === undefined) {
      throw new Error('expected done_total aggregate');
    }
    expect(formatAggregate(doneTotal)).toBe('1/2 done');
  });

  it('groups by lane column with tag fallback', () => {
    const tasks = [
      makeTask('typed', { lane: 'full' }),
      makeTask('tagged', { tags: [makeTag('l1', 'lane:auto')] }),
      makeTask('none', { lane: null }),
    ];

    const groups = groupTasks(tasks, [{ field: 'lane', direction: 'asc' }]);

    expect(groups.map((group) => group.label)).toEqual(['auto', 'full', 'No lane']);
    expect(groups.find((group) => group.value === 'full')?.tasks.map((task) => task.id)).toEqual([
      'typed',
    ]);
    expect(groups.find((group) => group.value === 'auto')?.tasks.map((task) => task.id)).toEqual([
      'tagged',
    ]);
  });

  it('sorts leaf tasks with sortTasks, not a local comparator', () => {
    const tasks = [
      makeTask('in_progress', { goal_id: 'goal-1', status: 'in_progress', label: 'Z' }),
      makeTask('scope', { goal_id: 'goal-1', status: 'scope', label: 'A' }),
      makeTask('todo', { goal_id: 'goal-1', status: 'todo', label: 'M' }),
    ];

    const groups = groupTasks(tasks, [{ field: 'goal_id', direction: 'asc' }], {
      sort: [{ field: 'status', direction: 'asc' }],
    });

    expect(groups[0]?.tasks.map((task) => task.id)).toEqual(['scope', 'todo', 'in_progress']);
  });
});
