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
});
