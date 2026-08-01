import { describe, expect, it } from 'vitest';
import {
  InvalidSavedViewConfigError,
  NON_TRIVIAL_SAVED_VIEW_CONFIG,
  parseSavedViewConfig,
} from './saved-view-config.js';

describe('parseSavedViewConfig', () => {
  it('accepts a nested filter, two-level sort, two-level group, and column set', () => {
    const parsed = parseSavedViewConfig(NON_TRIVIAL_SAVED_VIEW_CONFIG);
    expect(parsed).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);
    expect(parsed.filter).toMatchObject({
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'condition', field: 'status', operator: 'is', value: 'blocked' },
        {
          kind: 'group',
          op: 'or',
          children: [
            { kind: 'condition', field: 'priority', operator: 'is', value: 'urgent' },
            { kind: 'condition', field: 'tags', operator: 'contains', value: 'p0' },
          ],
        },
      ],
    });
    expect(parsed.sort).toHaveLength(2);
    expect(parsed.group).toHaveLength(2);
    expect(parsed.visibleColumns).toContain('due_date');
  });

  it('accepts a JSON string of the same shape', () => {
    const parsed = parseSavedViewConfig(JSON.stringify(NON_TRIVIAL_SAVED_VIEW_CONFIG));
    expect(parsed).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG);
  });

  it('rejects a config that does not match the schema', () => {
    expect(() => parseSavedViewConfig({ version: 1, filter: null })).toThrow(
      InvalidSavedViewConfigError,
    );
    expect(() =>
      parseSavedViewConfig({
        version: 2,
        filter: null,
        sort: [],
        group: null,
        visibleColumns: [],
      }),
    ).toThrow(/version/);
    expect(() =>
      parseSavedViewConfig({
        version: 1,
        filter: { kind: 'condition', field: 'status', operator: 'contains', value: 'x' },
        sort: [],
        group: null,
        visibleColumns: [],
      }),
    ).toThrow(/operator/);
    expect(() =>
      parseSavedViewConfig({
        version: 1,
        filter: null,
        sort: [{ field: 'not_a_field', direction: 'asc' }],
        group: null,
        visibleColumns: [],
      }),
    ).toThrow(/sort\[0\]\.field/);
    expect(() =>
      parseSavedViewConfig({
        version: 1,
        filter: null,
        sort: [],
        group: [
          { field: 'status', direction: 'asc' },
          { field: 'priority', direction: 'asc' },
          { field: 'assignee', direction: 'asc' },
        ],
        visibleColumns: [],
      }),
    ).toThrow(/one or two levels/);
  });
});
