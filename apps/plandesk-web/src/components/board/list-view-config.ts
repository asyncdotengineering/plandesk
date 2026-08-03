import { SAVED_VIEW_CONFIG_VERSION, type SavedViewConfig } from '@plandesk/db/saved-view-config';
import { LIST_COLUMNS, type ListColumnId } from './list-columns.js';
import type { FilterNode } from './task-filter.js';
import { toGroupSpecs } from './TaskListGroupMenu.js';
import type { GroupSpec } from './task-group.js';
import type { SortSpec } from './task-sort.js';

export function buildListViewConfig(input: {
  filter: FilterNode | null;
  sort: SortSpec[];
  groupSpecs: GroupSpec[];
  visibleColumns: Set<ListColumnId>;
}): SavedViewConfig {
  return {
    version: SAVED_VIEW_CONFIG_VERSION,
    filter: input.filter,
    sort: input.sort,
    group: toGroupSpecs(input.groupSpecs),
    visibleColumns: LIST_COLUMNS.filter((column) => input.visibleColumns.has(column)),
  };
}
