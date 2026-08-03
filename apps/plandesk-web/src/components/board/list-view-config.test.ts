import { describe, expect, it } from 'vitest';
import { NON_TRIVIAL_SAVED_VIEW_CONFIG } from '@plandesk/db/saved-view-config';
import { buildListViewConfig } from './list-view-config.js';

describe('buildListViewConfig', () => {
  it('maps live list state into a SavedViewConfig the API validator accepts', () => {
    const config = buildListViewConfig({
      filter: NON_TRIVIAL_SAVED_VIEW_CONFIG.filter,
      sort: NON_TRIVIAL_SAVED_VIEW_CONFIG.sort,
      groupSpecs: NON_TRIVIAL_SAVED_VIEW_CONFIG.group ?? [],
      visibleColumns: new Set(['label', 'status', 'assignee', 'due_date'] as const),
    });

    expect(config.filter).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG.filter);
    expect(config.sort).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG.sort);
    expect(config.group).toEqual(NON_TRIVIAL_SAVED_VIEW_CONFIG.group);
    expect(config.visibleColumns).toEqual(['label', 'status', 'assignee', 'due_date']);
  });
});
