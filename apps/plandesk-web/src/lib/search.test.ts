import { describe, expect, it } from 'vitest';
import { validateTaskFilterSearch } from './search.js';

describe('validateTaskFilterSearch', () => {
  it('keeps a valid status', () => {
    expect(validateTaskFilterSearch({ status: 'todo' })).toEqual({ status: 'todo' });
  });

  it('drops an unknown status', () => {
    expect(validateTaskFilterSearch({ status: 'nonsense' })).toEqual({});
  });

  // Without `task` in the search schema the board drawer is component state
  // only, so a document's link list had nowhere to point and clicking a task
  // just navigated to the board.
  it('keeps a task id so a task is addressable by URL', () => {
    expect(validateTaskFilterSearch({ task: 'abc-123' })).toEqual({ task: 'abc-123' });
  });

  it('keeps status and task together', () => {
    expect(validateTaskFilterSearch({ status: 'done', task: 'abc-123' })).toEqual({
      status: 'done',
      task: 'abc-123',
    });
  });

  it('drops a non-string or empty task', () => {
    expect(validateTaskFilterSearch({ task: 42 })).toEqual({});
    expect(validateTaskFilterSearch({ task: '' })).toEqual({});
  });

  it('ignores unrelated params', () => {
    expect(validateTaskFilterSearch({ nope: 'x' })).toEqual({});
  });

  it('parses multi-level sort from a comma-separated param', () => {
    expect(validateTaskFilterSearch({ sort: 'status:asc,label:desc' })).toEqual({
      sort: [
        { field: 'status', direction: 'asc' },
        { field: 'label', direction: 'desc' },
      ],
    });
  });

  it('drops invalid sort fields and directions', () => {
    expect(validateTaskFilterSearch({ sort: 'nope:asc,status:up' })).toEqual({});
    expect(validateTaskFilterSearch({ sort: 'status:asc,nope:desc' })).toEqual({
      sort: [{ field: 'status', direction: 'asc' }],
    });
  });

  it('parses visible columns from a comma-separated param', () => {
    expect(validateTaskFilterSearch({ columns: 'label,status,goal' })).toEqual({
      columns: ['label', 'status', 'goal'],
    });
  });

  it('drops unknown column ids', () => {
    expect(validateTaskFilterSearch({ columns: 'label,nope,status' })).toEqual({
      columns: ['label', 'status'],
    });
  });

  it('parses comma-separated sort and columns params', () => {
    expect(
      validateTaskFilterSearch({ sort: 'priority:desc,due_date:asc', columns: 'label,tags' }),
    ).toEqual({
      sort: [
        { field: 'priority', direction: 'desc' },
        { field: 'due_date', direction: 'asc' },
      ],
      columns: ['label', 'tags'],
    });
  });

  it('parses a nested filter JSON param', () => {
    const filter = {
      kind: 'group' as const,
      op: 'and' as const,
      children: [
        {
          kind: 'condition' as const,
          field: 'lane' as const,
          operator: 'is' as const,
          value: 'full',
        },
        {
          kind: 'group' as const,
          op: 'or' as const,
          children: [
            {
              kind: 'condition' as const,
              field: 'status' as const,
              operator: 'is' as const,
              value: 'todo',
            },
            {
              kind: 'condition' as const,
              field: 'status' as const,
              operator: 'is' as const,
              value: 'scope',
            },
          ],
        },
      ],
    };
    expect(validateTaskFilterSearch({ filter: JSON.stringify(filter) })).toEqual({ filter });
    expect(validateTaskFilterSearch({ filter: 'not-json' })).toEqual({});
  });
});
