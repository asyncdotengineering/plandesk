import { describe, expect, it } from 'vitest';
import type { SerializedTag, SerializedTask } from '../../lib/api.js';
import {
  FIELD_OPERATORS,
  defaultOperatorForField,
  filterTasks,
  operatorsForField,
  type FilterNode,
} from './task-filter.js';

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

function idsMatching(tasks: SerializedTask[], node: FilterNode): string[] {
  return filterTasks(tasks, node)
    .map((task) => task.id)
    .sort();
}

describe('evaluateFilter / filterTasks', () => {
  it('lane:full AND (status:todo OR status:scope) returns exactly the matching set', () => {
    const tasks = [
      makeTask('full-todo', {
        status: 'todo',
        tags: [makeTag('l1', 'lane:full')],
      }),
      makeTask('full-scope', {
        status: 'scope',
        tags: [makeTag('l2', 'lane:full')],
      }),
      makeTask('full-done', {
        status: 'done',
        tags: [makeTag('l3', 'lane:full')],
      }),
      makeTask('auto-todo', {
        status: 'todo',
        tags: [makeTag('l4', 'lane:auto')],
      }),
      makeTask('no-lane-todo', { status: 'todo' }),
      makeTask('full-progress', {
        status: 'in_progress',
        tags: [makeTag('l5', 'lane:full')],
      }),
    ];

    const node: FilterNode = {
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'condition', field: 'lane', operator: 'is', value: 'full' },
        {
          kind: 'group',
          op: 'or',
          children: [
            { kind: 'condition', field: 'status', operator: 'is', value: 'todo' },
            { kind: 'condition', field: 'status', operator: 'is', value: 'scope' },
          ],
        },
      ],
    };

    expect(idsMatching(tasks, node)).toEqual(['full-scope', 'full-todo']);
  });

  it('empty group and nested empty group return every task', () => {
    const tasks = [
      makeTask('a', { status: 'todo' }),
      makeTask('b', { status: 'scope' }),
      makeTask('c', { status: 'done' }),
    ];

    const empty: FilterNode = { kind: 'group', op: 'and', children: [] };
    expect(idsMatching(tasks, empty)).toEqual(['a', 'b', 'c']);

    const nestedEmpty: FilterNode = {
      kind: 'group',
      op: 'or',
      children: [{ kind: 'group', op: 'and', children: [] }],
    };
    expect(idsMatching(tasks, nestedEmpty)).toEqual(['a', 'b', 'c']);
  });

  it('empty OR group with no children matches nothing', () => {
    const tasks = [makeTask('a', { status: 'todo' }), makeTask('b', { status: 'scope' })];
    const emptyOr: FilterNode = { kind: 'group', op: 'or', children: [] };
    expect(idsMatching(tasks, emptyOr)).toEqual([]);
  });

  it('nesting three levels deep evaluates correctly', () => {
    // (lane:full AND status:todo) OR (priority:high AND (status:scope OR status:done))
    const tasks = [
      makeTask('full-todo', {
        status: 'todo',
        priority: 'low',
        tags: [makeTag('l1', 'lane:full')],
      }),
      makeTask('high-scope', { status: 'scope', priority: 'high' }),
      makeTask('high-done', { status: 'done', priority: 'high' }),
      makeTask('high-todo', { status: 'todo', priority: 'high' }),
      makeTask('full-scope', {
        status: 'scope',
        priority: 'low',
        tags: [makeTag('l2', 'lane:full')],
      }),
    ];

    const node: FilterNode = {
      kind: 'group',
      op: 'or',
      children: [
        {
          kind: 'group',
          op: 'and',
          children: [
            { kind: 'condition', field: 'lane', operator: 'is', value: 'full' },
            { kind: 'condition', field: 'status', operator: 'is', value: 'todo' },
          ],
        },
        {
          kind: 'group',
          op: 'and',
          children: [
            { kind: 'condition', field: 'priority', operator: 'is', value: 'high' },
            {
              kind: 'group',
              op: 'or',
              children: [
                { kind: 'condition', field: 'status', operator: 'is', value: 'scope' },
                { kind: 'condition', field: 'status', operator: 'is', value: 'done' },
              ],
            },
          ],
        },
      ],
    };

    expect(idsMatching(tasks, node)).toEqual(['full-todo', 'high-done', 'high-scope']);
  });

  it('is_empty / is_not_empty on assignee partition the full set', () => {
    const tasks = [
      makeTask('empty-null', { assignee: null }),
      makeTask('empty-str', { assignee: '' }),
      makeTask('alex', { assignee: 'alex' }),
      makeTask('blake', { assignee: 'blake' }),
    ];

    const emptyNode: FilterNode = {
      kind: 'condition',
      field: 'assignee',
      operator: 'is_empty',
      value: null,
    };
    const filledNode: FilterNode = {
      kind: 'condition',
      field: 'assignee',
      operator: 'is_not_empty',
      value: null,
    };

    const emptyIds = idsMatching(tasks, emptyNode);
    const filledIds = idsMatching(tasks, filledNode);

    expect(emptyIds).toEqual(['empty-null', 'empty-str']);
    expect(filledIds).toEqual(['alex', 'blake']);

    const all = new Set([...emptyIds, ...filledIds]);
    expect(all.size).toBe(tasks.length);
    expect([...all].sort()).toEqual(tasks.map((t) => t.id).sort());
    expect(emptyIds.filter((id) => filledIds.includes(id))).toEqual([]);
  });

  it('contains on tags matches a task carrying that tag among several', () => {
    const tasks = [
      makeTask('both', {
        tags: [makeTag('a', 'alpha'), makeTag('b', 'beta'), makeTag('l', 'lane:full')],
      }),
      makeTask('alpha-only', { tags: [makeTag('a2', 'alpha')] }),
      makeTask('beta-only', { tags: [makeTag('b2', 'beta')] }),
      makeTask('none', { tags: [] }),
    ];

    const node: FilterNode = {
      kind: 'condition',
      field: 'tags',
      operator: 'contains',
      value: 'alpha',
    };

    expect(idsMatching(tasks, node)).toEqual(['alpha-only', 'both']);
  });

  it('flat status is todo returns exactly the todo tasks', () => {
    const tasks = [
      makeTask('t1', { status: 'todo' }),
      makeTask('t2', { status: 'scope' }),
      makeTask('t3', { status: 'todo' }),
    ];
    const node: FilterNode = {
      kind: 'condition',
      field: 'status',
      operator: 'is',
      value: 'todo',
    };
    expect(idsMatching(tasks, node)).toEqual(['t1', 't3']);
  });

  it('null root passes every task through', () => {
    const tasks = [makeTask('a'), makeTask('b')];
    expect(filterTasks(tasks, null).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('FIELD_OPERATORS table', () => {
  it('allows before/after only on date fields', () => {
    for (const field of Object.keys(FIELD_OPERATORS) as (keyof typeof FIELD_OPERATORS)[]) {
      const ops = operatorsForField(field);
      const hasBefore = ops.includes('before');
      const hasAfter = ops.includes('after');
      const isDate = field === 'due_date' || field === 'created_at' || field === 'updated_at';
      expect(hasBefore).toBe(isDate);
      expect(hasAfter).toBe(isDate);
    }
  });

  it('allows contains only on text and tags fields', () => {
    for (const field of Object.keys(FIELD_OPERATORS) as (keyof typeof FIELD_OPERATORS)[]) {
      const hasContains = operatorsForField(field).includes('contains');
      const allows = field === 'label' || field === 'assignee' || field === 'tags';
      expect(hasContains).toBe(allows);
    }
  });

  it('defaults tags operator to contains', () => {
    expect(defaultOperatorForField('tags')).toBe('contains');
    expect(defaultOperatorForField('status')).toBe('is');
  });

  it('exposes no operators outside the table for a field', () => {
    expect(operatorsForField('status')).not.toContain('before');
    expect(operatorsForField('status')).not.toContain('contains');
    expect(operatorsForField('due_date')).toContain('before');
  });
});
