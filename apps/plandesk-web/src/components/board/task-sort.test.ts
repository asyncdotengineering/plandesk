import { describe, expect, it } from 'vitest';
import {
  taskPriorityOrder,
  taskStatuses,
  type SerializedTask,
  type TaskPriority,
} from '../../lib/api.js';
import { sortTasks, type SortSpec } from './task-sort.js';

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

describe('sortTasks', () => {
  it('orders status by declared workflow order (scope before in_progress)', () => {
    // Alphabetically `in_progress` precedes `scope` ('i' < 's'). Declared
    // workflow order is the opposite — this pair proves we are not string-sorting.
    const tasks = [
      makeTask('in_progress', { status: 'in_progress' }),
      makeTask('scope', { status: 'scope' }),
      makeTask('todo', { status: 'todo' }),
    ];

    const sorted = sortTasks(tasks, [{ field: 'status', direction: 'asc' }]);
    const statuses = sorted.map((task) => task.status);

    expect(statuses.indexOf('scope')).toBeLessThan(statuses.indexOf('in_progress'));
    expect(statuses).toEqual(
      [...statuses].sort((a, b) => taskStatuses.indexOf(a) - taskStatuses.indexOf(b)),
    );
  });

  it('orders priority by taskPriorityOrder, null last', () => {
    const tasks = [
      makeTask('low', { priority: 'low' }),
      makeTask('null', { priority: null }),
      makeTask('urgent', { priority: 'urgent' }),
      makeTask('medium', { priority: 'medium' }),
      makeTask('high', { priority: 'high' }),
    ];

    const sorted = sortTasks(tasks, [{ field: 'priority', direction: 'asc' }]);
    const priorities = sorted.map((task) => task.priority);

    const expected = (Object.keys(taskPriorityOrder) as TaskPriority[])
      .slice()
      .sort((a, b) => taskPriorityOrder[a] - taskPriorityOrder[b]);
    expect(priorities.slice(0, expected.length)).toEqual(expected);
    expect(priorities.at(-1)).toBeNull();
    expect(priorities).toHaveLength(tasks.length);
  });

  it('keeps input order when every sort key is equal (stable)', () => {
    const tasks = [
      makeTask('first', { status: 'todo', priority: 'medium', label: 'same' }),
      makeTask('second', { status: 'todo', priority: 'medium', label: 'same' }),
      makeTask('third', { status: 'todo', priority: 'medium', label: 'same' }),
    ];

    const specs: SortSpec[] = [
      { field: 'status', direction: 'asc' },
      { field: 'priority', direction: 'asc' },
      { field: 'label', direction: 'asc' },
    ];
    const sorted = sortTasks(tasks, specs);
    expect(sorted.map((task) => task.id)).toEqual(['first', 'second', 'third']);
  });

  it('applies two-level status then updated_at (workflow first, recency within)', () => {
    const tasks = [
      makeTask('scope-old', {
        status: 'scope',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
      makeTask('todo-new', {
        status: 'todo',
        updated_at: '2026-06-01T00:00:00.000Z',
      }),
      makeTask('scope-new', {
        status: 'scope',
        updated_at: '2026-06-01T00:00:00.000Z',
      }),
      makeTask('todo-old', {
        status: 'todo',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    ];

    const sorted = sortTasks(tasks, [
      { field: 'status', direction: 'asc' },
      { field: 'updated_at', direction: 'asc' },
    ]);

    expect(sorted.map((task) => task.id)).toEqual([
      'scope-old',
      'scope-new',
      'todo-old',
      'todo-new',
    ]);
  });

  it('sorts null last ascending and never drops rows', () => {
    const tasks = [
      makeTask('a', { assignee: null }),
      makeTask('b', { assignee: 'blake' }),
      makeTask('c', { assignee: '' }),
      makeTask('d', { assignee: 'alex' }),
    ];

    const sorted = sortTasks(tasks, [{ field: 'assignee', direction: 'asc' }]);
    expect(sorted).toHaveLength(tasks.length);
    expect(sorted.map((task) => task.id).slice(0, 2)).toEqual(['d', 'b']);
    expect(sorted.slice(2).every((task) => task.assignee === null || task.assignee === '')).toBe(
      true,
    );
  });

  it('orders label alphabetically and reverses on desc', () => {
    const tasks = [
      makeTask('c', { label: 'Charlie' }),
      makeTask('a', { label: 'Alice' }),
      makeTask('b', { label: 'Bob' }),
    ];

    const asc = sortTasks(tasks, [{ field: 'label', direction: 'asc' }]);
    expect(asc.map((task) => task.label)).toEqual(['Alice', 'Bob', 'Charlie']);

    const desc = sortTasks(tasks, [{ field: 'label', direction: 'desc' }]);
    expect(desc.map((task) => task.label)).toEqual(['Charlie', 'Bob', 'Alice']);
  });

  it('returns a copy when specs are empty', () => {
    const tasks = [makeTask('a'), makeTask('b')];
    const sorted = sortTasks(tasks, []);
    expect(sorted).toEqual(tasks);
    expect(sorted).not.toBe(tasks);
  });
});
